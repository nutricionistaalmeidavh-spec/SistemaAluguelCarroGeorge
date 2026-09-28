import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeD1,seedOperationFixture } from './helpers/fake-d1.mjs';
import { writeCloudBackup } from '../cloudflare/backup/r2-backup.mjs';
import { restoreCloudBackup } from '../cloudflare/backup/restore.mjs';
import { issueDeviceCredential } from '../cloudflare/auth/device-credentials.mjs';
import { createSessionRecord } from '../cloudflare/auth/session.mjs';

class FakeR2{
  constructor(){this.objects=new Map();}
  async put(key,body,options={}){this.objects.set(key,{body:String(body),options});}
  async get(key){const value=this.objects.get(key);if(!value)return null;return{text:async()=>value.body,customMetadata:value.options?.customMetadata??{}};}
}

test('restore cloud substitui dados, sobe geração e invalida sessões/credenciais antigas',async()=>{
  const db=new FakeD1(),r2=new FakeR2();
  try{
    const ids=seedOperationFixture(db),admin={installationId:ids.installationId,userId:ids.userId,role:'admin',active:true};
    const backup=await writeCloudBackup({DB:db,ATTACHMENTS:r2},ids.installationId,new Date('2026-09-27T03:17:00.000Z'));
    await issueDeviceCredential(db,admin,{deviceId:'PHONE-OLD',name:'Celular antigo',kind:'mobile'});
    await createSessionRecord(db,{installationId:ids.installationId,userId:ids.userId,deviceId:'PHONE-OLD',userAgent:'restore-test'});
    db.sqlite.prepare('UPDATE customers SET name=?,version=version+1 WHERE id=?').run('Nome posterior ao backup',ids.customerId);
    assert.equal(db.scalar('SELECT COUNT(*) FROM device_credentials WHERE installation_id=? AND revoked_at IS NULL',ids.installationId),1);
    assert.equal(db.scalar('SELECT COUNT(*) FROM sessions WHERE installation_id=? AND revoked_at IS NULL',ids.installationId),1);

    const restored=await restoreCloudBackup({DB:db,ATTACHMENTS:r2},{...admin,sessionId:'SES-ACTOR'},backup.id);

    assert.equal(restored.restoreGeneration,1);
    assert.equal(db.scalar('SELECT restore_generation FROM installations WHERE id=?',ids.installationId),1);
    assert.equal(db.scalar('SELECT name FROM customers WHERE id=?',ids.customerId),'Cliente Teste');
    assert.equal(db.scalar('SELECT COUNT(*) FROM device_credentials WHERE installation_id=?',ids.installationId),0);
    assert.equal(db.scalar('SELECT COUNT(*) FROM sessions WHERE installation_id=?',ids.installationId),0);
    assert.equal(db.scalar("SELECT status FROM restore_records WHERE id=?",restored.restoreId),'complete');
  }finally{db.close();}
});
