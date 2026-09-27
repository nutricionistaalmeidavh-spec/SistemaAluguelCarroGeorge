import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function load(relative){try{return await import(new URL(relative,import.meta.url));}catch(error){assert.fail(`Plano 03 ausente: ${relative}: ${error.message}`);}}

test('backup local só é válido com SQLite, anexos e hashes íntegros',async()=>{
  const {createLocalBackup,verifyLocalBackup}=await load('../electron/plan03/local-backup.cjs');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'george-p03-'));
  const databasePath=path.join(root,'locadora.sqlite'),attachmentsDir=path.join(root,'attachments'),backupRoot=path.join(root,'backups');
  fs.writeFileSync(databasePath,'sqlite-george');fs.mkdirSync(attachmentsDir);fs.writeFileSync(path.join(attachmentsDir,'foto.jpg'),'foto-ok');
  const result=await createLocalBackup({databasePath,attachmentsDir,backupRoot,now:new Date('2026-09-27T12:00:00.000Z')});
  assert.equal((await verifyLocalBackup(result.backupDir)).valid,true);
  fs.writeFileSync(path.join(result.backupDir,'attachments','foto.jpg'),'corrompido');
  const corrupt=await verifyLocalBackup(result.backupDir);assert.equal(corrupt.valid,false);assert.equal(corrupt.reason,'checksum_mismatch');
});

test('retenção mantém no máximo 7 diários, 4 semanais e 12 mensais',async()=>{
  const {selectRetention}=await load('../electron/plan03/local-backup.cjs');
  const backups=[];for(let i=0;i<420;i++)backups.push({id:`b${i}`,createdAt:new Date(Date.UTC(2026,8,27)-i*86400000).toISOString(),valid:true});
  const selected=selectRetention(backups,new Date('2026-09-27T12:00:00.000Z'));
  assert.ok(selected.keep.size<=23);assert.equal(selected.dailyBuckets.size,7);assert.equal(selected.weeklyBuckets.size,4);assert.equal(selected.monthlyBuckets.size,12);
});

test('restoreGeneration invalida clientes anteriores ao restore',async()=>{
  const {assertRestoreGeneration,nextRestoreGeneration}=await load('../electron/plan03/restore-generation.cjs');
  assert.equal(nextRestoreGeneration(4),5);assert.doesNotThrow(()=>assertRestoreGeneration(5,5));
  assert.throws(()=>assertRestoreGeneration(4,5),error=>error?.code==='restore_generation_mismatch');
});
