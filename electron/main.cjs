'use strict';
const {app,BrowserWindow,ipcMain,safeStorage}=require('electron');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const {SqliteStore}=require('./sqlite-store.cjs');
const {RelationalStore}=require('./relational-store.cjs');
const {AttachmentStore}=require('./attachment-store.cjs');
const {upgradeLegacyDatabase}=require('./legacy-upgrade.cjs');
const {startSyncServer}=require('./sync-server.cjs');
const {createDesktopCloudAuth}=require('./cloud-auth.cjs');
const {createReplicaClient}=require('./replica/cloud-client.cjs');
const {createSqliteReplicaStore}=require('./replica/sqlite-replica-store.cjs');
const {createReplicaStateStore}=require('./replica/state.cjs');
const {ReplicaAgent}=require('./replica/agent.cjs');
const {createLocalBackup,verifyLocalBackup,applyRetention}=require('./backup/local-backup.cjs');
const {stageLocalRestore,applyPendingRestore}=require('./backup/restore.cjs');

const APP_NAME='Sistema Locadora George';
const APP_ID='com.artisys.locadora.george';
const DATA_DIR_NAME='Sistema Locadora George';
const DB_FILE='locadora-george.sqlite';
const INSTALLATION_ID='LOCADORA-GEORGE';
const DESKTOP_DEVICE_ID='GEORGE-PC';
const REPLICA_CONFIG_KEY='plan03:replica-config';
const DEFAULT_CLOUD_BASE_URL='https://sistemaaluguelcarrogeorge.sistema-artisys.workers.dev';
const CLOUD_BASE_URL=String(process.env.LOCADORA_CLOUD_URL||DEFAULT_CLOUD_BASE_URL).trim();

function configureStoragePaths(){
  const userData=process.env.LOCADORA_E2E_USER_DATA?path.resolve(process.env.LOCADORA_E2E_USER_DATA):path.join(app.getPath('appData'),DATA_DIR_NAME);
  const sessionData=path.join(userData,'SessionData');
  fs.mkdirSync(userData,{recursive:true});
  fs.mkdirSync(sessionData,{recursive:true});
  app.setPath('userData',userData);
  app.setPath('sessionData',sessionData);
}
app.setName(APP_NAME);
if(process.platform==='win32')app.setAppUserModelId(APP_ID);
configureStoragePaths();

let syncInfo=null,store=null,relationalStore=null,attachmentStore=null,syncServer=null,replicaAgent=null,replicaStateStore=null,backupTimer=null,cloudAuth=null;

function tokenFromSqlite(){const current=store.get('sync:token');if(current)return current;const token=crypto.randomBytes(18).toString('hex').toUpperCase();store.set('sync:token',token);return token;}
function migrateLegacySidecars(userData){for(const [name,key] of [['sync-config.json','legacy:sync-config'],['sync-state.json','sync:server-state']]){const file=path.join(userData,name);if(!fs.existsSync(file))continue;try{const parsed=JSON.parse(fs.readFileSync(file,'utf8'));if(name==='sync-config.json'&&parsed?.token&&!store.get('sync:token'))store.set('sync:token',parsed.token);if(name==='sync-state.json'&&!store.get(key))store.setJson(key,parsed);fs.unlinkSync(file);}catch{}}}
function lanAddresses(){const values=[];for(const entries of Object.values(os.networkInterfaces()))for(const entry of entries||[])if(entry.family==='IPv4'&&!entry.internal)values.push(entry.address);return[...new Set(values)];}
async function loadRelationalCodecs(){const root=app.getAppPath(),toModule=await import(pathToFileURL(path.join(root,'src','migration','snapshot-to-relational.mjs')).href),fromModule=await import(pathToFileURL(path.join(root,'src','migration','relational-to-snapshot.mjs')).href),attachmentsModule=await import(pathToFileURL(path.join(root,'src','migration','legacy-attachments.mjs')).href);return{snapshotToRelational:toModule.snapshotToRelational,relationalToSnapshot:fromModule.relationalToSnapshot,migrateLegacyAttachments:attachmentsModule.migrateLegacyAttachments};}
async function migrateLegacyAttachmentFiles(migrateLegacyAttachments){if(relationalStore.isRelationalEmpty())return{migrated:0,errors:[]};const current=relationalStore.loadSnapshot(),result=await migrateLegacyAttachments(current,attachmentStore,{actorId:'SYSTEM'});if(result.migrated>0)relationalStore.saveSnapshot(result.snapshot);if(result.errors.length)console.warn(`[locadora] ${result.errors.length} foto(s) legada(s) não puderam ser migradas; dados base64 foram preservados.`);return result;}

async function startLanSync(){
  const userData=app.getPath('userData'),databasePath=path.join(userData,DB_FILE),migrationsDir=path.join(app.getAppPath(),'db','migrations');
  if(!fs.existsSync(databasePath)){const seed=new SqliteStore(databasePath);seed.close();}
  const codecs=await loadRelationalCodecs(),relationalOptions={installationId:INSTALLATION_ID,deviceId:DESKTOP_DEVICE_ID,migrationsDir,snapshotToRelational:codecs.snapshotToRelational,relationalToSnapshot:codecs.relationalToSnapshot};
  upgradeLegacyDatabase({databasePath,userData,...relationalOptions});
  relationalStore=RelationalStore.open(databasePath,relationalOptions);
  attachmentStore=AttachmentStore.open({databasePath,rootDir:path.join(userData,'attachments'),migrationsDir,installationId:INSTALLATION_ID,deviceId:DESKTOP_DEVICE_ID});
  await migrateLegacyAttachmentFiles(codecs.migrateLegacyAttachments);
  store=new SqliteStore(databasePath);
  migrateLegacySidecars(userData);
  const token=tokenFromSqlite(),rootDir=app.getAppPath(),legacySnapshotSync=process.env.LOCADORA_LEGACY_SNAPSHOT_SYNC==='1';
  try{syncServer=await startSyncServer({host:'0.0.0.0',port:4174,token,rootDir,store,legacySnapshotSync});}
  catch(error){if(error?.code!=='EADDRINUSE')throw error;syncServer=await startSyncServer({host:'0.0.0.0',port:0,token,rootDir,store,legacySnapshotSync});}
  const urls=lanAddresses().map(address=>`http://${address}:${syncServer.port}`);
  syncInfo={available:true,legacySnapshotSync,port:syncServer.port,token,localUrl:`http://127.0.0.1:${syncServer.port}`,urls,pairingUrls:urls.map(url=>`${url}/?pair=${encodeURIComponent(token)}`),database:databasePath,attachments:path.join(userData,'attachments')};
}

function encryptSecret(value){if(!safeStorage.isEncryptionAvailable())throw new Error('secure_storage_unavailable');return safeStorage.encryptString(String(value)).toString('base64');}
function decryptSecret(value){if(!value||!safeStorage.isEncryptionAvailable())return null;try{return safeStorage.decryptString(Buffer.from(String(value),'base64'));}catch{return null;}}
function replicaConfig(){const value=store?.getJson(REPLICA_CONFIG_KEY,null);if(!value?.baseUrl||!value?.deviceTokenEncrypted)return null;const deviceToken=decryptSecret(value.deviceTokenEncrypted);return deviceToken?{baseUrl:value.baseUrl,deviceToken}:null;}
function initializeCloudAuth(){cloudAuth=createDesktopCloudAuth({baseUrl:CLOUD_BASE_URL,installationId:INSTALLATION_ID,deviceId:DESKTOP_DEVICE_ID,store,safeStorage,fetchImpl:globalThis.fetch});return cloudAuth;}

async function startReplica(){
  await replicaAgent?.stop?.();replicaAgent=null;
  if(!replicaStateStore)replicaStateStore=createReplicaStateStore({kv:store,installationId:INSTALLATION_ID,deviceId:DESKTOP_DEVICE_ID});
  const config=cloudAuth?.replicaCredential?.()??replicaConfig();
  if(!config)return false;
  const client=createReplicaClient({baseUrl:config.baseUrl,sessionProvider:async()=>config.cookie?{cookie:config.cookie}:{deviceToken:config.deviceToken}}),local=createSqliteReplicaStore({relationalStore,attachmentStore,installationId:INSTALLATION_ID,deviceId:DESKTOP_DEVICE_ID});
  replicaAgent=new ReplicaAgent({client,local,stateStore:replicaStateStore,intervalMs:60000});
  try{await replicaAgent.syncNow();}catch(error){console.warn('[locadora] réplica inicial indisponível:',error?.message);}
  replicaAgent.start({immediate:false});
  return true;
}

function backupRoot(){return path.join(app.getPath('userData'),'backups');}
function latestBackupDir(){const root=backupRoot();if(!fs.existsSync(root))return null;const names=fs.readdirSync(root).filter(x=>!x.startsWith('.partial-')).sort().reverse();return names[0]?path.join(root,names[0]):null;}
async function createVerifiedLocalBackup(){const state=replicaStateStore?.load?.()||{},result=await createLocalBackup({databasePath:path.join(app.getPath('userData'),DB_FILE),attachmentsDir:path.join(app.getPath('userData'),'attachments'),backupRoot:backupRoot(),appVersion:app.getVersion(),installationId:INSTALLATION_ID,cursor:state.cursor||0,restoreGeneration:state.restoreGeneration||0});const verified=await verifyLocalBackup(result.backupDir);if(!verified.valid)throw new Error(`backup_verification_failed:${verified.reason}`);applyRetention(backupRoot());store.set('plan03:last-local-backup-day',new Date().toISOString().slice(0,10));return{backupDir:result.backupDir,manifest:result.manifest,verified:true};}
async function ensureDailyBackup(){const today=new Date().toISOString().slice(0,10);if(store.get('plan03:last-local-backup-day')===today)return null;return createVerifiedLocalBackup();}
async function diagnostics(){const latest=latestBackupDir(),backup=latest?await verifyLocalBackup(latest):{valid:false,reason:'no_backup'},state=replicaStateStore?.load?.()||null;return{ok:Boolean(fs.existsSync(path.join(app.getPath('userData'),DB_FILE))&&backup.valid),databasePath:path.join(app.getPath('userData'),DB_FILE),attachmentsPath:path.join(app.getPath('userData'),'attachments'),latestBackup:latest,backupValid:Boolean(backup.valid),backupReason:backup.valid?null:backup.reason,replica:replicaAgent?.status?.()||state||{configured:false},cloudConfigured:Boolean(cloudAuth?.status?.().authenticated||replicaConfig()),cloudAuth:cloudAuth?.status?.()??{configured:false},restorePending:fs.existsSync(path.join(app.getPath('userData'),'.restore-pending'))};}
async function startPlan03(){replicaStateStore=createReplicaStateStore({kv:store,installationId:INSTALLATION_ID,deviceId:DESKTOP_DEVICE_ID});await ensureDailyBackup().catch(error=>console.warn('[locadora] backup local:',error?.message));await startReplica();backupTimer=setInterval(()=>ensureDailyBackup().catch(error=>console.warn('[locadora] backup local:',error?.message)),6*60*60*1000);backupTimer.unref?.();}
function cloudFailure(error){return{ok:false,error:error?.code??error?.message??'cloud_auth_error',status:Number(error?.status)||0};}

function registerIpc(){
  ipcMain.handle('locadora:sync-info',()=>syncInfo);
  ipcMain.handle('locadora:snapshot:load',()=>relationalStore.isRelationalEmpty()?null:JSON.stringify(relationalStore.loadSnapshot()));
  ipcMain.handle('locadora:snapshot:save',(_e,value)=>{const snapshot=typeof value==='string'?JSON.parse(value):value;relationalStore.saveSnapshot(snapshot);return true;});
  ipcMain.handle('locadora:attachment:put',(_e,value)=>attachmentStore.put(value));
  ipcMain.handle('locadora:attachment:get',(_e,id)=>attachmentStore.get(id));
  ipcMain.handle('locadora:attachment:verify',(_e,id)=>attachmentStore.verify(id));
  ipcMain.handle('locadora:attachment:remove',(_e,id)=>attachmentStore.remove(id));
  ipcMain.handle('locadora:attachment:list',(_e,t,id)=>attachmentStore.listByEntity(t,id));
  ipcMain.handle('locadora:db:get',(_e,key)=>store.get(key));
  ipcMain.handle('locadora:db:set',(_e,key,value)=>store.set(key,value));
  ipcMain.handle('locadora:db:remove',(_e,key)=>store.remove(key));
  ipcMain.handle('locadora:replica:status',()=>replicaAgent?.status?.()||replicaStateStore?.load?.()||{configured:false});
  ipcMain.handle('locadora:replica:sync-now',async()=>{if(!replicaAgent)throw new Error('replica_not_configured');return replicaAgent.syncNow();});
  ipcMain.handle('locadora:replica:configure',async(_e,input={})=>{const baseUrl=String(input.baseUrl||'').trim(),deviceToken=String(input.deviceToken||'').trim();if(!baseUrl||deviceToken.length<32)throw new Error('replica_config_invalid');new URL(baseUrl);store.setJson(REPLICA_CONFIG_KEY,{baseUrl:new URL(baseUrl).origin,deviceTokenEncrypted:encryptSecret(deviceToken),updatedAt:new Date().toISOString()});await startReplica();return replicaAgent?.status?.()||{configured:true};});
  ipcMain.handle('locadora:cloud-auth:status',()=>({ok:true,...cloudAuth.status()}));
  ipcMain.handle('locadora:cloud-auth:login',async(_e,input={})=>{try{const result=await cloudAuth.login(input);await startReplica();return result;}catch(error){return cloudFailure(error);}});
  ipcMain.handle('locadora:cloud-auth:first-access',async(_e,input={})=>{try{const result=await cloudAuth.firstAccess(input);await startReplica();return result;}catch(error){return cloudFailure(error);}});
  ipcMain.handle('locadora:cloud-auth:logout',async()=>{try{await cloudAuth.logout();await replicaAgent?.stop?.();replicaAgent=null;return{ok:true};}catch(error){return cloudFailure(error);}});
  ipcMain.handle('locadora:backup-local:create',()=>createVerifiedLocalBackup());
  ipcMain.handle('locadora:restore-local:stage',(_e,backupDir)=>stageLocalRestore({backupDir:String(backupDir||''),userData:app.getPath('userData')}));
  ipcMain.handle('locadora:diagnostics',()=>diagnostics());
}

function createWindow(){const win=new BrowserWindow({width:1440,height:920,minWidth:1024,minHeight:680,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});win.loadURL(syncInfo.localUrl);}

app.whenReady().then(async()=>{
  await applyPendingRestore({userData:app.getPath('userData'),databaseFile:DB_FILE}).catch(error=>{console.error('[locadora] restore pendente falhou',error);throw error;});
  await startLanSync();
  initializeCloudAuth();
  await cloudAuth.restore().catch(error=>console.warn('[locadora] sessão cloud não pôde ser validada:',error?.message));
  await startPlan03();
  registerIpc();
  createWindow();
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
});
app.on('before-quit',()=>{try{if(backupTimer)clearInterval(backupTimer);}catch{}try{replicaAgent?.stop?.();}catch{}try{syncServer?.close();}catch{}try{store?.close();}catch{}try{attachmentStore?.close();}catch{}try{relationalStore?.close();}catch{}});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
