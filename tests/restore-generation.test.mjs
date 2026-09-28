import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeD1,seedOperationFixture } from './helpers/fake-d1.mjs';
import { createSessionRecord,buildSessionCookie } from '../cloudflare/auth/session.mjs';
import worker from '../cloudflare/worker.mjs';

test('Worker rejeita mutação de device com geração anterior ao restore antes de tocar nos dados',async()=>{
  const db=new FakeD1();
  try{
    const ids=seedOperationFixture(db);db.sqlite.prepare('UPDATE installations SET restore_generation=4 WHERE id=?').run(ids.installationId);
    const session=await createSessionRecord(db,{installationId:ids.installationId,userId:ids.userId,deviceId:'PHONE-STALE',userAgent:'dr-test'});
    const before=db.scalar('SELECT COUNT(*) FROM customers WHERE installation_id=?',ids.installationId);
    const request=new Request('https://george.example/api/v1/customers',{method:'POST',headers:{origin:'https://george.example',cookie:buildSessionCookie(session.token),'content-type':'application/json','x-locadora-restore-generation':'3'},body:JSON.stringify({name:'Registro que não pode ressuscitar'})});
    const response=await worker.fetch(request,{DB:db},{waitUntil(){}}),body=await response.json();
    assert.equal(response.status,409);assert.equal(body.error,'restore_generation_mismatch');assert.equal(body.restoreGeneration,4);assert.equal(body.clientGeneration,3);
    assert.equal(db.scalar('SELECT COUNT(*) FROM customers WHERE installation_id=?',ids.installationId),before);
  }finally{db.close();}
});
