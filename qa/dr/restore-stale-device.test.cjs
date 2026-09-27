'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');

test('device offline anterior ao restore é rejeitado até aprender a nova geração',async()=>{
  const {FakeD1,seedOperationFixture}=await import('../../tests/helpers/fake-d1.mjs');
  const {checkSyncGeneration}=await import('../../cloudflare/sync/generation.mjs');
  const db=new FakeD1();
  try{
    const ids=seedOperationFixture(db);db.sqlite.prepare('UPDATE installations SET restore_generation=4 WHERE id=?').run(ids.installationId);
    const auth={installationId:ids.installationId,userId:ids.userId,deviceId:'PHONE-OFFLINE'};
    const stale=new Request('https://george.example/api/v1/sync/operations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({restoreGeneration:3,operations:[]})});
    const rejected=await checkSyncGeneration(stale,db,auth);
    assert.equal(rejected.ok,false);assert.equal(rejected.error,'restore_generation_mismatch');assert.equal(rejected.serverGeneration,4);assert.equal(rejected.clientGeneration,3);
    const rebased=new Request('https://george.example/api/v1/sync/operations',{method:'POST',headers:{'content-type':'application/json','x-locadora-restore-generation':'4'},body:JSON.stringify({operations:[]})});
    assert.equal((await checkSyncGeneration(rebased,db,auth)).ok,true);
  }finally{db.close();}
});
