import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeD1,seedOperationFixture } from './helpers/fake-d1.mjs';
import { writeCloudBackup,readVerifiedManifest } from '../cloudflare/backup/r2-backup.mjs';

class FakeR2{
  constructor({failManifest=false}={}){this.objects=new Map();this.failManifest=failManifest;}
  async put(key,body,options={}){if(this.failManifest&&key.endsWith('/manifest.json'))throw new Error('simulated_manifest_failure');this.objects.set(key,{body:String(body),options});}
  async get(key){const value=this.objects.get(key);if(!value)return null;return{text:async()=>value.body,customMetadata:value.options?.customMetadata??{}};}
}

test('backup D1→R2 só vira valid depois do manifest completo e verificável',async()=>{
  const db=new FakeD1(),r2=new FakeR2();
  try{
    const ids=seedOperationFixture(db),backup=await writeCloudBackup({DB:db,ATTACHMENTS:r2},ids.installationId,new Date('2026-09-27T03:17:00.000Z'));
    assert.equal(db.scalar('SELECT status FROM cloud_backups WHERE id=?',backup.id),'valid');
    assert.ok(backup.manifestKey.endsWith('/manifest.json'));
    assert.ok(r2.objects.has(backup.manifestKey));
    const verified=await readVerifiedManifest({DB:db,ATTACHMENTS:r2},ids.installationId,backup.id);
    assert.equal(verified.manifest.status,'complete');
    assert.equal(verified.manifest.installationId,ids.installationId);
    assert.ok(verified.manifest.objects.length>=4,'esperava chunks das tabelas seedadas');
  }finally{db.close();}
});

test('falha ao escrever manifest mantém backup inválido',async()=>{
  const db=new FakeD1(),r2=new FakeR2({failManifest:true});
  try{
    const ids=seedOperationFixture(db);
    await assert.rejects(()=>writeCloudBackup({DB:db,ATTACHMENTS:r2},ids.installationId,new Date('2026-09-27T03:17:00.000Z')),/simulated_manifest_failure/);
    const latest=db.sqlite.prepare('SELECT status,manifest_key,completed_at FROM cloud_backups WHERE installation_id=? ORDER BY created_at DESC LIMIT 1').get(ids.installationId);
    assert.equal(latest.status,'failed');
    assert.equal(latest.manifest_key,null);
    assert.equal(latest.completed_at,null);
    assert.equal(db.scalar("SELECT COUNT(*) FROM cloud_backups WHERE installation_id=? AND status='valid'",ids.installationId),0);
  }finally{db.close();}
});
