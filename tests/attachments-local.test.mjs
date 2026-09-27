import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import attachmentModule from '../electron/attachment-store.cjs';
import migrationRunner from '../electron/migration-runner.cjs';

const { AttachmentStore } = attachmentModule;
const { applyMigrations } = migrationRunner;
const migrationsDir = fileURLToPath(new URL('../db/migrations/', import.meta.url));
const INSTALLATION_ID='LOCADORA-GEORGE';

function tempPaths(){
  const dir=mkdtempSync(join(tmpdir(),'locadora-attachments-'));
  return {dir,databasePath:join(dir,'locadora.sqlite'),rootDir:join(dir,'attachments')};
}

function seedInstallation(databasePath){
  const db=new DatabaseSync(databasePath);
  try{
    db.exec('PRAGMA foreign_keys=ON;');
    applyMigrations(db,migrationsDir);
    const now='2026-09-27T12:00:00.000Z';
    db.prepare(`INSERT INTO installations(id,name,created_at,updated_at,version,updated_by_device,deleted_at)
      VALUES(?,?,?,?,?,?,?)`).run(INSTALLATION_ID,'Locadora George',now,now,1,'TEST-DEVICE',null);
  }finally{db.close();}
}

const input={
  id:'ATT-001',
  entityType:'inspection',
  entityId:'INS-001',
  mimeType:'image/jpeg',
  bytes:Buffer.from('foto-binaria-baseline'),
  createdBy:'USR-001'
};

test('AttachmentStore grava arquivo atomicamente, persiste metadata e reabre com SHA válido',()=>{
  const paths=tempPaths();let store;
  try{
    seedInstallation(paths.databasePath);
    store=AttachmentStore.open({...paths,migrationsDir,installationId:INSTALLATION_ID});
    const metadata=store.put(input);
    assert.equal(metadata.id,input.id);
    assert.equal(metadata.entityType,input.entityType);
    assert.equal(metadata.entityId,input.entityId);
    assert.equal(metadata.mimeType,input.mimeType);
    assert.equal(metadata.sizeBytes,input.bytes.length);
    assert.match(metadata.sha256,/^[a-f0-9]{64}$/);
    assert.ok(existsSync(join(paths.rootDir,metadata.localPath)));
    assert.deepEqual(store.get(input.id),input.bytes);
    assert.deepEqual(store.verify(input.id),{
      ok:true,
      expectedSha256:metadata.sha256,
      actualSha256:metadata.sha256
    });
    store.close();

    store=AttachmentStore.open({...paths,migrationsDir,installationId:INSTALLATION_ID});
    assert.deepEqual(store.get(input.id),input.bytes);
    assert.equal(store.listByEntity('inspection','INS-001').length,1);
  }finally{
    try{store?.close();}catch{}
    rmSync(paths.dir,{recursive:true,force:true});
  }
});

test('AttachmentStore detecta arquivo corrompido sem alterar metadata esperada',()=>{
  const paths=tempPaths();let store;
  try{
    seedInstallation(paths.databasePath);
    store=AttachmentStore.open({...paths,migrationsDir,installationId:INSTALLATION_ID});
    const metadata=store.put(input);
    writeFileSync(join(paths.rootDir,metadata.localPath),Buffer.from('conteudo-corrompido'));
    const verification=store.verify(input.id);
    assert.equal(verification.ok,false);
    assert.equal(verification.expectedSha256,metadata.sha256);
    assert.match(verification.actualSha256,/^[a-f0-9]{64}$/);
    assert.notEqual(verification.actualSha256,metadata.sha256);
  }finally{
    try{store?.close();}catch{}
    rmSync(paths.dir,{recursive:true,force:true});
  }
});

test('AttachmentStore remove metadata e arquivo juntos',()=>{
  const paths=tempPaths();let store;
  try{
    seedInstallation(paths.databasePath);
    store=AttachmentStore.open({...paths,migrationsDir,installationId:INSTALLATION_ID});
    const metadata=store.put(input);
    const absolute=join(paths.rootDir,metadata.localPath);
    assert.equal(store.remove(input.id),true);
    assert.equal(store.get(input.id),null);
    assert.equal(existsSync(absolute),false);
  }finally{
    try{store?.close();}catch{}
    rmSync(paths.dir,{recursive:true,force:true});
  }
});
