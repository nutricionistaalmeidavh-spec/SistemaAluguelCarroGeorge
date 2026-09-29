'use strict';
const {_electron}=require('../../artisys-qa/node_modules/playwright');const {mkdtempSync,rmSync}=require('node:fs');const {tmpdir}=require('node:os');const {join,resolve}=require('node:path');
async function launchLocadora({legacySnapshotSync=false}={}){
 const root=resolve(__dirname,'..','..','..');const dir=mkdtempSync(join(tmpdir(),'artisys-locadora-e2e-'));let app;
 try{
  app=await _electron.launch({executablePath:process.env.LOCADORA_E2E_EXECUTABLE||undefined,args:[...(process.env.LOCADORA_E2E_EXECUTABLE?[]:[root]),'--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'],env:{...process.env,LOCADORA_E2E_USER_DATA:dir,LOCADORA_DISABLE_CLOUD_AUTH:'1',LOCADORA_LEGACY_SNAPSHOT_SYNC:legacySnapshotSync?'1':'0',ELECTRON_ENABLE_LOGGING:'1'}});
  const page=await app.firstWindow();
  return{app,page,dir,async close(){try{await Promise.race([app.close(),new Promise((_,r)=>setTimeout(()=>r(new Error('Electron close timeout')),5000))]);}catch{try{app.process()?.kill('SIGKILL')}catch{}}finally{rmSync(dir,{recursive:true,force:true});}}};
 }catch(e){try{await app?.close()}catch{}rmSync(dir,{recursive:true,force:true});throw e;}
}
module.exports={launchLocadora};
