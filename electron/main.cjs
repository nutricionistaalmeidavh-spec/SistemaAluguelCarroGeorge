'use strict';
const {app,BrowserWindow,ipcMain,safeStorage}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const {SqliteStore}=require('./sqlite-store.cjs');
const {RelationalStore}=require('./relational-store.cjs');
const {AttachmentStore}=require('./attachment-store.cjs');
const {upgradeLegacyDatabase}=require('./legacy-upgrade.cjs');
const {createDesktopCloudAuth}=require('./cloud-auth.cjs');
const {buildCloudOperations}=require('./cloud-sync-operations.cjs');
const {createDesktopCloudSyncController}=require('./cloud-sync-controller.cjs');
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
  fs.mkdirSync(userData,{recursive:true});fs.mkdirSync(sessionData,{recursive:true});
  app.setPath('userData',userData);app.setPath('sessionData',sessionData);
}
app.setName(APP_NAME);if(process.platform==='win32')app.setAppUserModelId(APP_ID);configureStoragePaths();

let store=null,relationalStore=null,attachmentStore=null,replicaAgent=null,replicaStateStore=null,backupTimer=null,cloudAuth=null,cloudSync=null,cloudSyncTimer=null;

async function loadRelationalCodecs(){const root=app.getAppPath(),toModule=await import(pathToFileURL(path.join(root,'src','migration','snapshot-to-relational.mjs')).href),fromModule=await import(pathToFileURL(path.join(root,'src','migration','relational-to-snapshot.mjs')).href),attachmentsModule=await import(pathToFileURL(path.join(root,'src','migration','legacy-attachments.mjs')).href);return{snapshotToRelational:toModule.snapshotToRelational,relationalToSnapshot:fromModule.relationalToSnapshot,migrateLegacyAttachments:attachmentsModule.migrateLegacyAttachments};}
async function migrateLegacyAttachmentFiles(migrateLegacyAttachments){if(relationalStore.isRelationalEmpty())return{migrated:0,errors:[]};const current=relationalStore.loadSnapshot(),result=await migrateLegacyAttachments(current,attachmentStore,{actorId:'SYSTEM'});if(result.migrated>0)relationalStore.saveSnapshot(result.snapshot);if(result.errors.length)console.warn(`[locadora] ${result.errors.length} foto(s) legada(s) não puderam ser migradas; dados base64 foram preservados.`);return result;}
async function initializeLocalStorage(){
  const userData=app.getPath('userData'),databasePath=path.join(userData,DB_FILE),migrationsDir=path.join(app.getAppPath(),'db','migrations');
  if(!fs.existsSync(databasePath)){const seed=new SqliteStore(databasePath);seed.close();}
  const codecs=await loadRelationalCodecs(),relationalOptions={installationId:INSTALLATION_ID,deviceId:DESKTOP_DEVICE_ID,migrationsDir,snapshotToRelational:codecs.snapshotToRelational,relationalToSnapshot:codecs.relationalToSnapshot};
  upgradeLegacyDatabase({databasePath,userData,...relationalOptions});
  relationalStore=RelationalStore.open(databasePath,relationalOptions);
  attachmentStore=AttachmentStore.open({databasePath,rootDir:path.join(userData,'attachments'),migrationsDir,installationId:INSTALLATION_ID,deviceId:DESKTOP_DEVICE_ID});
  await migrateLegacyAttachmentFiles(codecs.migrateLegacyAttachments);
  store=new SqliteStore(databasePath);
}

function encryptSecret(value){if(!safeStorage.isEncryptionAvailable())throw new Error('secure_storage_unavailable');return safeStorage.encryptString(String(value)).toString('base64');}
function decryptSecret(value){if(!value||!safeStorage.isEncryptionAvailable())return null;try{return safeStorage.decryptString(Buffer.from(String(value),'base64'));}catch{return null;}}
function replicaConfig(){const value=store?.getJson(REPLICA_CONFIG_KEY,null);if(!value?.baseUrl||!value?.deviceTokenEncrypted)return null;const deviceToken=decryptSecret(value.deviceTokenEncrypted);return deviceToken?{baseUrl:value.baseUrl,deviceToken}:null;}
function initializeCloudAuth(){cloudAuth=createDesktopCloudAuth({baseUrl:CLOUD_BASE_URL,installationId:INSTALLATION_ID,deviceId:DESKTOP_DEVICE_ID,store,safeStorage,fetchImpl:globalThis.fetch});return cloudAuth;}
function notifyReplicaChanged(status){for(const win of BrowserWindow.getAllWindows())if(!win.isDestroyed())win.webContents.send('locadora:replica:changed',status);}

async function startReplica(){
  await replicaAgent?.stop?.();replicaAgent=null;
  if(!replicaStateStore)replicaStateStore=createReplicaStateStore({kv:store,installationId:INSTALLATION_ID,deviceId:DESKTOP_DEVICE_ID});
  const config=cloudAuth?.replicaCredential?.()??replicaConfig();if(!config)return false;
  const client=createReplicaClient({baseUrl:config.baseUrl,sessionProvider:async()=>config.cookie?{cookie:config.cookie}:{deviceToken:config.deviceToken}}),local=createSqliteReplicaStore({relationalStore,attachmentStore,installationId:INSTALLATION_ID,deviceId:DESKTOP_DEVICE_ID});
  replicaAgent=new ReplicaAgent({client,local,stateStore:replicaStateStore,intervalMs:60000,onSynced:status=>notifyReplicaChanged(status)});
  try{await replicaAgent.syncNow();}catch(error){console.warn('[locadora] réplica inicial indisponível:',error?.message);}
  replicaAgent.start({immediate:false});return true;
}

async function initializeCloudSync(){
  if(cloudSync)return cloudSync;const root=app.getAppPath();
  const [{createOutbox},{runOutbox},{createApiClient}]=await Promise.all([import(pathToFileURL(path.join(root,'src','sync','outbox.mjs')).href),import(pathToFileURL(path.join(root,'src','sync','outbox-runner.mjs')).href),import(pathToFileURL(path.join(root,'src','api','client.mjs')).href)]);
  const outbox=createOutbox(store,{key:'desktop:cloud-outbox:v1'});
  const fetchImpl=async(url,options={})=>{const credential=cloudAuth?.replicaCredential?.();if(!credential?.cookie)throw Object.assign(new Error('cloud_not_authenticated'),{status:401});const headers=new Headers(options.headers||{});headers.set('cookie',credential.cookie);headers.set('origin',new URL(credential.baseUrl).origin);return globalThis.fetch(url,{...options,headers});};
  const api=createApiClient({baseUrl:CLOUD_BASE_URL,fetchImpl,maxRetries:1});
  const blobs={async get(id){const meta=attachmentStore?.metadata?.(id),bytes=attachmentStore?.get?.(id);if(!meta||!bytes)return null;return{blob:new Blob([bytes],{type:meta.mimeType||'application/octet-stream'}),meta:{entityType:meta.entityType,entityId:meta.entityId,mimeType:meta.mimeType,fileName:meta.originalName||''}};},async remove(){return true;}};
  cloudSync=createDesktopCloudSyncController({outbox,runOutbox,api,blobs,authenticated:()=>Boolean(cloudAuth?.status?.().authenticated),pull:async()=>replicaAgent?.syncNow?.()});return cloudSync;
}
function scheduleCloudFlush(delay=250){if(cloudSyncTimer)clearTimeout(cloudSyncTimer);cloudSyncTimer=setTimeout(()=>initializeCloudSync().then(controller=>controller.flush()).catch(error=>console.warn('[locadora] envio cloud:',error?.message)),Math.max(0,Number(delay)||0));cloudSyncTimer.unref?.();}
function attachmentOperation(kind,id){const attachmentId=String(id||'');return{operationId:`desktop:attachment.${kind}:${attachmentId}`.slice(0,160),kind:`attachment.${kind}`,payload:{attachmentId}};}

function backupRoot(){return path.join(app.getPath('userData'),'backups');}
function latestBackupDir(){const root=backupRoot();if(!fs.existsSync(root))return null;const names=fs.readdirSync(root).filter(x=>!x.startsWith('.partial-')).sort().reverse();return names[0]?path.join(root,names[0]):null;}
async function createVerifiedLocalBackup(){const state=replicaStateStore?.load?.()||{},result=await createLocalBackup({databasePath:path.join(app.getPath('userData'),DB_FILE),attachmentsDir:path.join(app.getPath('userData'),'attachments'),backupRoot:backupRoot(),appVersion:app.getVersion(),installationId:INSTALLATION_ID,cursor:state.cursor||0,restoreGeneration:state.restoreGeneration||0});const verified=await verifyLocalBackup(result.backupDir);if(!verified.valid)throw new Error(`backup_verification_failed:${verified.reason}`);applyRetention(backupRoot());store.set('plan03:last-local-backup-day',new Date().toISOString().slice(0,10));return{backupDir:result.backupDir,manifest:result.manifest,verified:true};}
async function ensureDailyBackup(){const today=new Date().toISOString().slice(0,10);if(store.get('plan03:last-local-backup-day')===today)return null;return createVerifiedLocalBackup();}
async function diagnostics(){const latest=latestBackupDir(),backup=latest?await verifyLocalBackup(latest):{valid:false,reason:'no_backup'},state=replicaStateStore?.load?.()||null;return{ok:Boolean(fs.existsSync(path.join(app.getPath('userData'),DB_FILE))&&backup.valid),databasePath:path.join(app.getPath('userData'),DB_FILE),attachmentsPath:path.join(app.getPath('userData'),'attachments'),latestBackup:latest,backupValid:Boolean(backup.valid),backupReason:backup.valid?null:backup.reason,replica:replicaAgent?.status?.()||state||{configured:false},cloudConfigured:Boolean(cloudAuth?.status?.().authenticated||replicaConfig()),cloudAuth:cloudAuth?.status?.()??{configured:false},cloudSync:cloudSync?await cloudSync.status():null,restorePending:fs.existsSync(path.join(app.getPath('userData'),'.restore-pending'))};}
async function startPlan03(){replicaStateStore=createReplicaStateStore({kv:store,installationId:INSTALLATION_ID,deviceId:DESKTOP_DEVICE_ID});await ensureDailyBackup().catch(error=>console.warn('[locadora] backup local:',error?.message));await startReplica();backupTimer=setInterval(()=>ensureDailyBackup().catch(error=>console.warn('[locadora] backup local:',error?.message)),6*60*60*1000);backupTimer.unref?.();}
function cloudFailure(error){return{ok:false,error:error?.code??error?.message??'cloud_auth_error',status:Number(error?.status)||0};}

function registerIpc(){
  ipcMain.handle('locadora:snapshot:load',()=>relationalStore.isRelationalEmpty()?null:JSON.stringify(relationalStore.loadSnapshot()));
  ipcMain.handle('locadora:snapshot:save',async(_e,value)=>{const snapshot=typeof value==='string'?JSON.parse(value):value,before=relationalStore.isRelationalEmpty()?{}:relationalStore.loadSnapshot(),operations=buildCloudOperations(before,snapshot);relationalStore.saveSnapshot(snapshot);if(cloudAuth?.status?.().authenticated&&operations.length){const controller=await initializeCloudSync();await controller.enqueueOperations(operations);scheduleCloudFlush(50);}return true;});
  ipcMain.handle('locadora:attachment:put',async(_e,value)=>{const item=attachmentStore.put(value);if(cloudAuth?.status?.().authenticated){const controller=await initializeCloudSync();await controller.enqueueOperations([attachmentOperation('upload',item.id)]);scheduleCloudFlush(50);}return item;});
  ipcMain.handle('locadora:attachment:get',(_e,id)=>attachmentStore.get(id));ipcMain.handle('locadora:attachment:verify',(_e,id)=>attachmentStore.verify(id));
  ipcMain.handle('locadora:attachment:remove',async(_e,id)=>{const attachmentId=String(id||'');if(cloudAuth?.status?.().authenticated){const controller=await initializeCloudSync();await controller.enqueueOperations([attachmentOperation('delete',attachmentId)]);}const removed=attachmentStore.remove(attachmentId);if(cloudAuth?.status?.().authenticated)scheduleCloudFlush(50);return removed;});
  ipcMain.handle('locadora:attachment:list',(_e,t,id)=>attachmentStore.listByEntity(t,id));ipcMain.handle('locadora:db:get',(_e,key)=>store.get(key));ipcMain.handle('locadora:db:set',(_e,key,value)=>store.set(key,value));ipcMain.handle('locadora:db:remove',(_e,key)=>store.remove(key));
  ipcMain.handle('locadora:replica:status',()=>replicaAgent?.status?.()||replicaStateStore?.load?.()||{configured:false});ipcMain.handle('locadora:replica:sync-now',async()=>{if(!replicaAgent)throw new Error('replica_not_configured');return replicaAgent.syncNow();});
  ipcMain.handle('locadora:replica:configure',async(_e,input={})=>{const baseUrl=String(input.baseUrl||'').trim(),deviceToken=String(input.deviceToken||'').trim();if(!baseUrl||deviceToken.length<32)throw new Error('replica_config_invalid');new URL(baseUrl);store.setJson(REPLICA_CONFIG_KEY,{baseUrl:new URL(baseUrl).origin,deviceTokenEncrypted:encryptSecret(deviceToken),updatedAt:new Date().toISOString()});await startReplica();return replicaAgent?.status?.()||{configured:true};});
  ipcMain.handle('locadora:cloud-sync:status',async()=>{const controller=await initializeCloudSync();return{authenticated:Boolean(cloudAuth?.status?.().authenticated),...(await controller.status())};});
  ipcMain.handle('locadora:cloud-sync:sync-now',async()=>{const controller=await initializeCloudSync();return controller.flush();});
  ipcMain.handle('locadora:cloud-sync:conflicts',async()=>{const controller=await initializeCloudSync();return controller.conflicts();});
  ipcMain.handle('locadora:cloud-sync:resolve-conflict',async(_e,id,input={})=>{const controller=await initializeCloudSync();return controller.resolveConflict(String(id||''),{strategy:String(input.strategy||'accept-cloud')});});
  ipcMain.handle('locadora:cloud-auth:status',()=>({ok:true,...cloudAuth.status()}));
  ipcMain.handle('locadora:cloud-auth:login',async(_e,input={})=>{try{const result=await cloudAuth.login(input);await startReplica();scheduleCloudFlush(0);return result;}catch(error){return cloudFailure(error);}});
  ipcMain.handle('locadora:cloud-auth:first-access',async(_e,input={})=>{try{const result=await cloudAuth.firstAccess(input);await startReplica();scheduleCloudFlush(0);return result;}catch(error){return cloudFailure(error);}});
  ipcMain.handle('locadora:cloud-auth:logout',async()=>{try{await cloudAuth.logout();await replicaAgent?.stop?.();replicaAgent=null;return{ok:true};}catch(error){return cloudFailure(error);}});
  ipcMain.handle('locadora:backup-local:create',()=>createVerifiedLocalBackup());ipcMain.handle('locadora:restore-local:stage',(_e,backupDir)=>stageLocalRestore({backupDir:String(backupDir||''),userData:app.getPath('userData')}));ipcMain.handle('locadora:diagnostics',()=>diagnostics());
}

function createWindow(){const win=new BrowserWindow({width:1440,height:920,minWidth:1024,minHeight:680,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});win.loadFile(path.join(app.getAppPath(),'index.html'));}

app.whenReady().then(async()=>{
  await applyPendingRestore({userData:app.getPath('userData'),databaseFile:DB_FILE}).catch(error=>{console.error('[locadora] restore pendente falhou',error);throw error;});
  await initializeLocalStorage();initializeCloudAuth();
  await cloudAuth.restore().catch(error=>console.warn('[locadora] sessão cloud não pôde ser validada:',error?.message));
  await startPlan03();await initializeCloudSync();if(cloudAuth.status().authenticated)scheduleCloudFlush(0);registerIpc();createWindow();
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
});
app.on('before-quit',()=>{try{if(backupTimer)clearInterval(backupTimer);}catch{}try{if(cloudSyncTimer)clearTimeout(cloudSyncTimer);}catch{}try{replicaAgent?.stop?.();}catch{}try{store?.close();}catch{}try{attachmentStore?.close();}catch{}try{relationalStore?.close();}catch{}});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
