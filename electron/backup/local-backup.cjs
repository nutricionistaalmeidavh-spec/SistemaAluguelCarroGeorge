'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

function sha256File(file){const hash=crypto.createHash('sha256');hash.update(fs.readFileSync(file));return hash.digest('hex');}
function safeMkdir(dir){fs.mkdirSync(dir,{recursive:true});}
function copyTree(source,target,files,prefix='attachments'){
  if(!fs.existsSync(source))return;
  for(const entry of fs.readdirSync(source,{withFileTypes:true})){
    const from=path.join(source,entry.name),to=path.join(target,entry.name),relative=path.posix.join(prefix,entry.name);
    if(entry.isDirectory()){safeMkdir(to);copyTree(from,to,files,relative);continue;}
    if(!entry.isFile())continue;
    safeMkdir(path.dirname(to));fs.copyFileSync(from,to);files.push({path:relative,sizeBytes:fs.statSync(to).size,sha256:sha256File(to)});
  }
}
function sqliteSnapshot(source,target){
  const header=fs.readFileSync(source,{encoding:null}).subarray(0,16).toString('utf8');
  if(header!=='SQLite format 3\u0000'){fs.copyFileSync(source,target);return;}
  const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(source);try{
    try{db.exec('PRAGMA wal_checkpoint(FULL);');}catch{}
    const quoted=String(target).replaceAll("'","''");db.exec(`VACUUM INTO '${quoted}'`);
  }finally{db.close();}
}
function backupId(now){return `${now.toISOString().replace(/[:.]/g,'-')}-${crypto.randomUUID()}`;}
async function createLocalBackup({databasePath,attachmentsDir,backupRoot,now=new Date(),appVersion='unknown',installationId='LOCADORA-GEORGE',cursor=0,restoreGeneration=0}={}){
  if(!databasePath||!backupRoot)throw new TypeError('databasePath e backupRoot são obrigatórios.');
  if(!fs.existsSync(databasePath))throw Object.assign(new Error('database_missing'),{code:'database_missing'});
  safeMkdir(backupRoot);const id=backupId(now),temp=path.join(backupRoot,`.partial-${id}`),final=path.join(backupRoot,id);safeMkdir(temp);
  const files=[];try{
    const dbTarget=path.join(temp,'locadora-george.sqlite');sqliteSnapshot(databasePath,dbTarget);files.push({path:'locadora-george.sqlite',sizeBytes:fs.statSync(dbTarget).size,sha256:sha256File(dbTarget)});
    const attachmentsTarget=path.join(temp,'attachments');safeMkdir(attachmentsTarget);if(attachmentsDir)copyTree(attachmentsDir,attachmentsTarget,files);
    const manifest={schemaVersion:1,id,installationId,createdAt:now.toISOString(),appVersion,cursor:Number(cursor)||0,restoreGeneration:Number(restoreGeneration)||0,status:'complete',files};
    fs.writeFileSync(path.join(temp,'manifest.json'),JSON.stringify(manifest,null,2));fs.writeFileSync(path.join(temp,'VALID'),`${manifest.createdAt}\n`);
    fs.renameSync(temp,final);return{backupDir:final,manifest};
  }catch(error){try{fs.rmSync(temp,{recursive:true,force:true});}catch{}throw error;}
}
async function verifyLocalBackup(backupDir){
  try{
    if(!fs.existsSync(path.join(backupDir,'VALID')))return{valid:false,reason:'missing_valid_marker'};
    const manifest=JSON.parse(fs.readFileSync(path.join(backupDir,'manifest.json'),'utf8'));if(manifest.status!=='complete'||!Array.isArray(manifest.files))return{valid:false,reason:'manifest_incomplete'};
    for(const entry of manifest.files){const file=path.join(backupDir,...String(entry.path).split('/'));if(!fs.existsSync(file))return{valid:false,reason:'file_missing',path:entry.path};if(sha256File(file)!==entry.sha256)return{valid:false,reason:'checksum_mismatch',path:entry.path};}
    return{valid:true,manifest};
  }catch(error){return{valid:false,reason:'invalid_backup',error:error.message};}
}
function dayKey(date){return date.toISOString().slice(0,10);}
function monthKey(date){return date.toISOString().slice(0,7);}
function weekKey(date){const d=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()));const day=d.getUTCDay()||7;d.setUTCDate(d.getUTCDate()+4-day);const start=new Date(Date.UTC(d.getUTCFullYear(),0,1));const week=Math.ceil((((d-start)/86400000)+1)/7);return `${d.getUTCFullYear()}-W${String(week).padStart(2,'0')}`;}
function chooseBuckets(items,keyFn,limit){const map=new Map();for(const item of items){const key=keyFn(new Date(item.createdAt));if(!map.has(key))map.set(key,item);}return new Map([...map.entries()].slice(0,limit));}
function selectRetention(backups,_now=new Date(),policy={daily:7,weekly:4,monthly:12}){
  const valid=(backups||[]).filter(x=>x?.valid!==false&&Number.isFinite(new Date(x.createdAt).getTime())).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const daily=chooseBuckets(valid,dayKey,policy.daily),weekly=chooseBuckets(valid,weekKey,policy.weekly),monthly=chooseBuckets(valid,monthKey,policy.monthly),keep=new Set();
  for(const map of [daily,weekly,monthly])for(const item of map.values())keep.add(item.id);
  if(valid.length&&!keep.size)keep.add(valid[0].id);
  return{keep,dailyBuckets:new Set(daily.keys()),weeklyBuckets:new Set(weekly.keys()),monthlyBuckets:new Set(monthly.keys())};
}
function applyRetention(backupRoot,policy){if(!fs.existsSync(backupRoot))return{removed:[],kept:[]};const backups=[];for(const name of fs.readdirSync(backupRoot)){if(name.startsWith('.partial-'))continue;const dir=path.join(backupRoot,name);try{const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));backups.push({id:name,createdAt:manifest.createdAt,valid:fs.existsSync(path.join(dir,'VALID'))});}catch{}}
  const selected=selectRetention(backups,new Date(),policy),removed=[];for(const item of backups)if(!selected.keep.has(item.id)){fs.rmSync(path.join(backupRoot,item.id),{recursive:true,force:true});removed.push(item.id);}return{removed,kept:[...selected.keep]};}
exports.createLocalBackup=createLocalBackup;exports.verifyLocalBackup=verifyLocalBackup;exports.selectRetention=selectRetention;exports.applyRetention=applyRetention;
