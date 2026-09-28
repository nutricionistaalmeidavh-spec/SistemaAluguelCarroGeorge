'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');

test('edições concorrentes na mesma versão retornam conflito explícito e preservam a primeira',async()=>{
  const {FakeD1,seedOperationFixture}=await import('../../tests/helpers/fake-d1.mjs');
  const {handleSyncRoute}=await import('../../cloudflare/api/sync-routes.mjs');
  const db=new FakeD1();
  try{
    const ids=seedOperationFixture(db),base={installationId:ids.installationId,userId:ids.userId,role:'admin',active:true};
    const request=(operation)=>new Request('https://george.example/api/v1/sync/operations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operations:[operation]})});
    const a=await handleSyncRoute(request({operationId:'OP-DR-A',kind:'customer.update',baseVersion:1,payload:{id:ids.customerId,data:{name:'Nome do device A'}}}),{DB:db},null,{auth:{...base,deviceId:'PHONE-A'}});
    assert.equal(a.status,200);
    const b=await handleSyncRoute(request({operationId:'OP-DR-B',kind:'customer.update',baseVersion:1,payload:{id:ids.customerId,data:{name:'Nome do device B'}}}),{DB:db},null,{auth:{...base,deviceId:'PHONE-B'}});
    const body=await b.json();
    assert.equal(b.status,409);assert.equal(body.error,'version_conflict');assert.equal(body.current.name,'Nome do device A');
    assert.equal(db.scalar('SELECT name FROM customers WHERE id=?',ids.customerId),'Nome do device A');
    assert.equal(db.scalar("SELECT COUNT(*) FROM sync_changes WHERE operation_id='OP-DR-B'"),0);
  }finally{db.close();}
});
