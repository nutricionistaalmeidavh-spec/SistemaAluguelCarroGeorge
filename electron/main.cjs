const { app, BrowserWindow, ipcMain } = require('electron');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const fs=require('node:fs');
const { pathToFileURL }=require('node:url');
const { SqliteStore }=require('./sqlite-store.cjs');
const { RelationalStore }=require('./relational-store.cjs');
const { AttachmentStore }=require('./attachment-store.cjs');
const { upgradeLegacyDatabase }=require('./legacy-upgrade.cjs');
const { startSyncServer }=require('./sync-server.cjs');

const APP_NAME='Sistema Locadora George';
const APP_ID='com.artisys.locadora.george';
const DATA_DIR_NAME='Sistema Locadora George';
const DB_FILE='locadora-george.sqlite';
const INSTALLATION_ID='LOCADORA-GEORGE';
const DESKTOP_DEVICE_ID='GEORGE-PC';

function configureStoragePaths(){
  const userData=process.env.LOCADORA_E2E_USER_DATA
    ? path.resolve(process.env.LOCADORA_E2E_USER_DATA)
    : path.join(app.getPath('appData'),DATA_DIR_NAME);
  const sessionData=path.join(userData,'SessionData');
  fs.mkdirSync(userData,{recursive:true});
  fs.mkdirSync(sessionData,{recursive:true});
  app.setPath('userData',userData);
  app.setPath('sessionData',sessionData);
}

app.setName(APP_NAME);
if(process.platform==='win32')app.setAppUserModelId(APP_ID);
configureStoragePaths();

let syncInfo=null,store=null,relationalStore=null,attachmentStore=null,syncServer=null;

function tokenFromSqlite(){
  const current=store.get('sync:token');if(current)return current;
  const token=crypto.randomBytes(18).toString('hex').toUpperCase();store.set('sync:token',token);return token;
}

function migrateLegacySidecars(userData){
  for(const [name,key] of [['sync-config.json','legacy:sync-config'],['sync-state.json','sync:server-state']]){
    const file=path.join(userData,name);if(!fs.existsSync(file))continue;
    try{const parsed=JSON.parse(fs.readFileSync(file,'utf8'));if(name==='sync-config.json'&&parsed?.token&&!store.get('sync:token'))store.set('sync:token',parsed.token);if(name==='sync-state.json'&&!store.get(key))store.setJson(key,parsed);fs.unlinkSync(file);}catch{}
  }
}

function lanAddresses(){
  const values=[];for(const entries of Object.values(os.networkInterfaces()))for(const entry of entries||[])if(entry.family==='IPv4'&&!entry.internal)values.push(entry.address);return [...new Set(values)];
}

async function loadRelationalCodecs(){
  const root=app.getAppPath();
  const toModule=await import(pathToFileURL(path.join(root,'src','migration','snapshot-to-relational.mjs')).href);
  const fromModule=await import(pathToFileURL(path.join(root,'src','migration','relational-to-snapshot.mjs')).href);
  return {snapshotToRelational:toModule.snapshotToRelational,relationalToSnapshot:fromModule.relationalToSnapshot};
}

async function startLanSync(){
  const userData=app.getPath('userData');
  const databasePath=path.join(userData,DB_FILE);
  const migrationsDir=path.join(app.getAppPath(),'db','migrations');
  if(!fs.existsSync(databasePath)){const seed=new SqliteStore(databasePath);seed.close();}
  const codecs=await loadRelationalCodecs();
  const relationalOptions={installationId:INSTALLATION_ID,deviceId:DESKTOP_DEVICE_ID,migrationsDir,...codecs};
  upgradeLegacyDatabase({databasePath,userData,...relationalOptions});
  relationalStore=RelationalStore.open(databasePath,relationalOptions);
  attachmentStore=AttachmentStore.open({databasePath,rootDir:path.join(userData,'attachments'),migrationsDir,installationId:INSTALLATION_ID,deviceId:DESKTOP_DEVICE_ID});
  store=new SqliteStore(databasePath);
  migrateLegacySidecars(userData);
  const token=tokenFromSqlite(),rootDir=app.getAppPath();
  try{syncServer=await startSyncServer({host:'0.0.0.0',port:4174,token,rootDir,store});}
  catch(error){if(error?.code!=='EADDRINUSE')throw error;syncServer=await startSyncServer({host:'0.0.0.0',port:0,token,rootDir,store});}
  const urls=lanAddresses().map(address=>`http://${address}:${syncServer.port}`);
  syncInfo={available:true,port:syncServer.port,token,localUrl:`http://127.0.0.1:${syncServer.port}`,urls,pairingUrls:urls.map(url=>`${url}/?pair=${encodeURIComponent(token)}`),database:databasePath,attachments:path.join(userData,'attachments')};
}

function registerIpc(){
  ipcMain.handle('locadora:sync-info',()=>syncInfo);
  ipcMain.handle('locadora:snapshot:load',()=>relationalStore.isRelationalEmpty()?null:JSON.stringify(relationalStore.loadSnapshot()));
  ipcMain.handle('locadora:snapshot:save',(_event,value)=>{const snapshot=typeof value==='string'?JSON.parse(value):value;relationalStore.saveSnapshot(snapshot);return true;});
  ipcMain.handle('locadora:attachment:put',(_event,value)=>attachmentStore.put(value));
  ipcMain.handle('locadora:attachment:get',(_event,id)=>attachmentStore.get(id));
  ipcMain.handle('locadora:attachment:verify',(_event,id)=>attachmentStore.verify(id));
  ipcMain.handle('locadora:attachment:remove',(_event,id)=>attachmentStore.remove(id));
  ipcMain.handle('locadora:attachment:list',(_event,entityType,entityId)=>attachmentStore.listByEntity(entityType,entityId));
  ipcMain.handle('locadora:db:get',(_event,key)=>store.get(key));
  ipcMain.handle('locadora:db:set',(_event,key,value)=>store.set(key,value));
  ipcMain.handle('locadora:db:remove',(_event,key)=>store.remove(key));
}

function createWindow(){
  const win=new BrowserWindow({width:1440,height:920,minWidth:1024,minHeight:680,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.loadURL(syncInfo.localUrl);
}

app.whenReady().then(async()=>{await startLanSync();registerIpc();createWindow();app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});});
app.on('before-quit',()=>{try{syncServer?.close();}catch{}try{store?.close();}catch{}try{attachmentStore?.close();}catch{}try{relationalStore?.close();}catch{}});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
