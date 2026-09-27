import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import attachmentModule from '../electron/attachment-store.cjs';
import migrationRunner from '../electron/migration-runner.cjs';
import { buildLegacySnapshotFixture } from './fixtures/build-legacy-snapshot.mjs';
import { migrateLegacyAttachments } from '../src/migration/legacy-attachments.mjs';

const { AttachmentStore }=attachmentModule;
const { applyMigrations }=migrationRunner;
const migrationsDir=fileURLToPath(new URL('../db/migrations/',import.meta.url));
const installationId='LOCADORA-GEORGE';

function createStore(){
  const dir=mkdtempSync(join(tmpdir(),'locadora-legacy-attachments-'));
  const databasePath=join(dir,'locadora.sqlite'),rootDir=join(dir,'attachments');
  const db=new DatabaseSync(databasePath);
  try{
    db.exec('PRAGMA foreign_keys=ON;');applyMigrations(db,migrationsDir);
    const now='2026-09-27T12:00:00.000Z';
    db.prepare(`INSERT INTO installations(id,name,created_at,updated_at,version,updated_by_device,deleted_at) VALUES(?,?,?,?,?,?,?)`)
      .run(installationId,'Locadora George',now,now,1,'TEST-DEVICE',null);
  }finally{db.close();}
  return {dir,store:AttachmentStore.open({databasePath,rootDir,migrationsDir,installationId,deviceId:'TEST-DEVICE'})};
}

test('migra foto base64 legada para attachment e remove dataUrl somente após persistência',async()=>{
  const {dir,store}=createStore();
  try{
    const source=await buildLegacySnapshotFixture();
    const inspection=source.inspections[0];
    assert.match(inspection.photos[0].dataUrl,/^data:image\/jpeg;base64,/);

    const result=await migrateLegacyAttachments(source,store,{actorId:'USR-001'});
    assert.equal(result.errors.length,0);
    assert.equal(result.migrated,1);
    const photo=result.snapshot.inspections[0].photos[0];
    assert.equal('dataUrl' in photo,false);
    assert.equal(photo.attachmentId,'ATT-'+inspection.photos[0].id);
    assert.equal(photo.mimeType,'image/jpeg');
    assert.equal(photo.sizeBytes,1);
    assert.match(photo.sha256,/^[a-f0-9]{64}$/);
    assert.equal(store.verify(photo.attachmentId).ok,true);
    assert.equal(store.listByEntity('inspection',inspection.id).length,1);

    const second=await migrateLegacyAttachments(result.snapshot,store,{actorId:'USR-001'});
    assert.equal(second.migrated,0);
    assert.equal(second.errors.length,0);
    assert.equal(store.listByEntity('inspection',inspection.id).length,1);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('foto legada inválida gera erro explícito e permanece no snapshot para recuperação',async()=>{
  const {dir,store}=createStore();
  try{
    const source=await buildLegacySnapshotFixture();
    source.inspections[0].photos[0].dataUrl='data:text/plain;base64,QQ==';
    const result=await migrateLegacyAttachments(source,store,{actorId:'USR-001'});
    assert.equal(result.migrated,0);
    assert.equal(result.errors.length,1);
    assert.match(result.errors[0].message,/formato|imagem|data url/i);
    assert.equal(result.snapshot.inspections[0].photos[0].dataUrl,'data:text/plain;base64,QQ==');
    assert.equal(store.listByEntity('inspection',source.inspections[0].id).length,0);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
