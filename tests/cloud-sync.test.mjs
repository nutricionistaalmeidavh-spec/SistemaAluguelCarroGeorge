import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeD1, seedOperationFixture } from './helpers/fake-d1.mjs';
import { handleSyncRoute } from '../cloudflare/api/sync-routes.mjs';
import { createCacheStore } from '../src/storage/cache-store.mjs';
import { createCloudSync } from '../src/sync/cloud-sync.mjs';

function memoryKv(){const values=new Map();return{async get(key){return values.has(key)?values.get(key):null;},async set(key,value){values.set(String(key),String(value));return true;},async remove(key){values.delete(String(key));return true;},async flush(){return true;}};}
function auth(ids,deviceId){return{installationId:ids.installationId,userId:ids.userId,deviceId,role:'admin',active:true};}
function serverApi(db,actor){
  return{async request(path,{method='GET',body,operationId}={}){
    const headers={'content-type':'application/json'};if(operationId)headers['idempotency-key']=operationId;
    const response=await handleSyncRoute(new Request(`https://app.test${path}`,{method,headers,body:body==null?undefined:JSON.stringify(body)}),{DB:db},null,{auth:actor});
    const data=response.status===204?null:await response.json();
    if(!response.ok){const error=new Error(data?.error??`http_${response.status}`);error.status=response.status;error.code=data?.error;error.details=data;throw error;}
    return data;
  }};
}

test('dois dispositivos convergem por delta/cursor sem snapshot completo',async()=>{
  const db=new FakeD1();
  try{
    const ids=seedOperationFixture(db),storeA=memoryKv(),storeB=memoryKv(),cacheA=createCacheStore({store:storeA}),cacheB=createCacheStore({store:storeB});
    const syncA=createCloudSync({api:serverApi(db,auth(ids,'DEV-A')),cache:cacheA,store:storeA});
    const syncB=createCloudSync({api:serverApi(db,auth(ids,'DEV-B')),cache:cacheB,store:storeB});

    const created=await syncA.pushOperations([{operationId:'OP-A-CREATE',kind:'customer.create',payload:{id:'CUS-SYNC',name:'Ana',phone:'111'}}]);
    assert.equal(created[0].status,'applied');
    const pullA1=await syncA.pullChanges();assert.equal(pullA1.applied,1);assert.ok(pullA1.cursor>0);
    const pullB1=await syncB.pullChanges();assert.equal(pullB1.applied,1);assert.equal((await cacheB.getResource('customers')).find(x=>x.id==='CUS-SYNC').name,'Ana');

    const updated=await syncB.pushOperations([{operationId:'OP-B-UPDATE',kind:'customer.update',baseVersion:1,payload:{id:'CUS-SYNC',data:{name:'Ana B'}}}]);
    assert.equal(updated[0].status,'applied');
    const pullA2=await syncA.pullChanges();assert.equal(pullA2.applied,1);assert.ok(pullA2.cursor>pullA1.cursor);
    assert.equal((await cacheA.getResource('customers')).find(x=>x.id==='CUS-SYNC').name,'Ana B');
    assert.equal(db.scalar('SELECT version FROM customers WHERE installation_id=? AND id=?',ids.installationId,'CUS-SYNC'),2);
  }finally{db.close();}
});

test('delete lógico vira tombstone e remove entidade no outro dispositivo',async()=>{
  const db=new FakeD1();
  try{
    const ids=seedOperationFixture(db),store=memoryKv(),cache=createCacheStore({store}),sync=createCloudSync({api:serverApi(db,auth(ids,'DEV-B')),cache,store}),apiA=serverApi(db,auth(ids,'DEV-A'));
    await apiA.request('/api/v1/sync/operations',{method:'POST',operationId:'OP-CREATE',body:{operations:[{operationId:'OP-CREATE',kind:'customer.create',payload:{id:'CUS-DEL',name:'Excluir'}}]}});
    await sync.pullChanges();assert.ok((await cache.getResource('customers')).some(x=>x.id==='CUS-DEL'));
    await apiA.request('/api/v1/sync/operations',{method:'POST',operationId:'OP-DELETE',body:{operations:[{operationId:'OP-DELETE',kind:'customer.delete',baseVersion:1,payload:{id:'CUS-DEL'}}]}});
    const pulled=await sync.pullChanges();
    assert.equal(pulled.applied,1);assert.equal((await cache.getResource('customers')).some(x=>x.id==='CUS-DEL'),false);
    assert.equal(db.scalar('SELECT COUNT(*) FROM customers WHERE installation_id=? AND id=? AND deleted_at IS NOT NULL',ids.installationId,'CUS-DEL'),1);
  }finally{db.close();}
});

test('baseVersion antiga retorna conflito estruturado com versão atual',async()=>{
  const db=new FakeD1();
  try{
    const ids=seedOperationFixture(db),api=serverApi(db,auth(ids,'DEV-A'));
    await api.request('/api/v1/sync/operations',{method:'POST',operationId:'OP-C1',body:{operations:[{operationId:'OP-C1',kind:'customer.create',payload:{id:'CUS-CONFLICT',name:'V1'}}]}});
    await api.request('/api/v1/sync/operations',{method:'POST',operationId:'OP-C2',body:{operations:[{operationId:'OP-C2',kind:'customer.update',baseVersion:1,payload:{id:'CUS-CONFLICT',data:{name:'V2'}}}]}});
    await assert.rejects(()=>api.request('/api/v1/sync/operations',{method:'POST',operationId:'OP-C3',body:{operations:[{operationId:'OP-C3',kind:'customer.update',baseVersion:1,payload:{id:'CUS-CONFLICT',data:{name:'STALE'}}}]}}),error=>error?.status===409&&error?.details?.current?.version===2&&error?.details?.current?.name==='V2');
    assert.equal(db.scalar('SELECT name FROM customers WHERE installation_id=? AND id=?',ids.installationId,'CUS-CONFLICT'),'V2');
  }finally{db.close();}
});

test('replay do mesmo operationId não duplica entidade nem change log',async()=>{
  const db=new FakeD1();
  try{
    const ids=seedOperationFixture(db),api=serverApi(db,auth(ids,'DEV-A')),body={operations:[{operationId:'OP-REPLAY',kind:'customer.create',payload:{id:'CUS-REPLAY',name:'Uma vez'}}]};
    const first=await api.request('/api/v1/sync/operations',{method:'POST',operationId:'OP-REPLAY',body});
    const second=await api.request('/api/v1/sync/operations',{method:'POST',operationId:'OP-REPLAY',body});
    assert.equal(first.results[0].status,'applied');assert.equal(second.results[0].status,'replayed');
    assert.equal(db.scalar('SELECT COUNT(*) FROM customers WHERE installation_id=? AND id=?',ids.installationId,'CUS-REPLAY'),1);
    assert.equal(db.scalar('SELECT COUNT(*) FROM sync_changes WHERE installation_id=? AND operation_id=?',ids.installationId,'OP-REPLAY'),1);
  }finally{db.close();}
});
