import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutbox } from '../src/sync/outbox.mjs';
import { runOutbox } from '../src/sync/outbox-runner.mjs';
import { createOfflineBlobStore } from '../src/storage/offline-blob-store.mjs';

function memoryKv(){
  const values=new Map();
  return{kind:'memory-test',async get(key){return values.has(key)?values.get(key):null;},async set(key,value){values.set(String(key),String(value));return true;},async remove(key){values.delete(String(key));return true;},dump(){return new Map(values);}};
}
function memoryBlobBackend(){
  const values=new Map();
  return{async put(id,value){values.set(String(id),value);return true;},async get(id){return values.get(String(id))??null;},async remove(id){return values.delete(String(id));},async has(id){return values.has(String(id));},async list(){return [...values.keys()];}};
}

test('outbox e blob offline sobrevivem recriação preservando ordem e operação',async()=>{
  const kv=memoryKv(),backend=memoryBlobBackend();
  const outboxA=createOutbox(kv,{now:()=>new Date('2026-09-27T20:00:00.000Z')});
  await outboxA.enqueue({id:'Q-1',operationId:'OP-1',kind:'customer.create',payload:{name:'Ana'}});
  await outboxA.enqueue({id:'Q-2',operationId:'OP-2',kind:'rental.payment',payload:{rentalId:'LOC-1',amount:80}});
  const blobsA=createOfflineBlobStore({backend});
  await blobsA.put('ATT-1',new Blob(['foto'],{type:'image/jpeg'}),{entityType:'inspection',entityId:'INS-1',fileName:'foto.jpg'});

  const outboxB=createOutbox(kv),blobsB=createOfflineBlobStore({backend});
  const items=await outboxB.list();
  assert.deepEqual(items.map(item=>item.id),['Q-1','Q-2']);
  assert.deepEqual(items.map(item=>item.status),['pending','pending']);
  assert.deepEqual(items.map(item=>item.operationId),['OP-1','OP-2']);
  const stored=await blobsB.get('ATT-1');
  assert.equal(await stored.blob.text(),'foto');
  assert.equal(stored.meta.entityId,'INS-1');
});

test('estados da outbox persistem e conflito exige resolução explícita em vez de retry automático',async()=>{
  const kv=memoryKv(),outbox=createOutbox(kv,{now:()=>new Date('2026-09-27T20:00:00.000Z')});
  await outbox.enqueue({id:'Q-1',operationId:'OP-1',kind:'customer.update',payload:{id:'CUS-1'}});
  await outbox.markSending('Q-1');
  assert.equal((await outbox.get('Q-1')).status,'sending');
  await outbox.markConflict('Q-1',{code:'version_conflict',details:{current:{id:'CUS-1',version:3}}});
  assert.equal((await outbox.get('Q-1')).status,'conflict');
  await assert.rejects(()=>outbox.retry('Q-1'),/conflict_requires_resolution/);
  const resolved=await outbox.resolveConflict('Q-1',{strategy:'accept-cloud'});
  assert.equal(resolved.status,'synced');
  assert.equal(resolved.result.resolution,'accept-cloud');
  assert.deepEqual(resolved.result.cloud,{id:'CUS-1',version:3});
  assert.equal((await outbox.list()).length,1);
});

test('retry após timeout reutiliza operationId e contabiliza pagamento uma única vez',async()=>{
  const kv=memoryKv(),outbox=createOutbox(kv,{now:()=>new Date('2026-09-27T20:00:00.000Z')});
  await outbox.enqueue({id:'Q-PAY',operationId:'OP-PAY-1',kind:'rental.payment',payload:{rentalId:'LOC-1',amount:80,method:'pix'}});
  const seenReceipts=new Map();let attempts=0,financialWrites=0;
  const api={async payRental(rentalId,payload,{operationId}){
    attempts++;
    assert.equal(rentalId,'LOC-1');assert.equal(operationId,'OP-PAY-1');
    if(!seenReceipts.has(operationId)){financialWrites++;seenReceipts.set(operationId,{id:'PAY-1',amount:payload.amount});}
    if(attempts===1)throw new TypeError('network_down_after_server_commit');
    return seenReceipts.get(operationId);
  }};
  const first=await runOutbox({outbox,api,now:()=>new Date('2026-09-27T20:00:00.000Z'),baseRetryMs:0});
  assert.equal(first.failed,1);assert.equal((await outbox.get('Q-PAY')).status,'failed');
  await outbox.retry('Q-PAY');
  const second=await runOutbox({outbox,api,now:()=>new Date('2026-09-27T20:00:01.000Z'),baseRetryMs:0});
  assert.equal(second.synced,1);assert.equal((await outbox.get('Q-PAY')).status,'synced');
  assert.equal(attempts,2);assert.equal(financialWrites,1);
});

test('conflito 409 fica explícito e não entra em retry automático',async()=>{
  const kv=memoryKv(),outbox=createOutbox(kv);
  await outbox.enqueue({id:'Q-UPD',operationId:'OP-UPD',kind:'customer.update',payload:{id:'CUS-1',data:{name:'Novo'},expectedVersion:1}});
  const api={async update(){const error=new Error('version_conflict');error.status=409;error.code='version_conflict';error.details={current:{id:'CUS-1',version:2,name:'Servidor'}};throw error;}};
  const result=await runOutbox({outbox,api});
  assert.equal(result.conflicts,1);
  const item=await outbox.get('Q-UPD');
  assert.equal(item.status,'conflict');assert.equal(item.lastError.code,'version_conflict');
});

test('attachment offline só remove blob depois de confirmação do upload',async()=>{
  const kv=memoryKv(),backend=memoryBlobBackend(),outbox=createOutbox(kv),blobs=createOfflineBlobStore({backend});
  await blobs.put('ATT-1',new Blob(['evidencia'],{type:'image/jpeg'}),{entityType:'inspection',entityId:'INS-1',fileName:'evidencia.jpg'});
  await outbox.enqueue({id:'Q-ATT',operationId:'OP-ATT-1',kind:'attachment.upload',payload:{attachmentId:'ATT-1'}});
  let calls=0;
  const api={async uploadAttachment(id,input){calls++;assert.equal(id,'ATT-1');assert.equal(await input.body.text(),'evidencia');if(calls===1)throw new TypeError('offline');return{id,status:'ready'};}};
  await runOutbox({outbox,api,blobs,baseRetryMs:0});
  assert.equal(await blobs.has('ATT-1'),true);assert.equal((await outbox.get('Q-ATT')).status,'failed');
  await outbox.retry('Q-ATT');
  await runOutbox({outbox,api,blobs,baseRetryMs:0});
  assert.equal(await blobs.has('ATT-1'),false);assert.equal((await outbox.get('Q-ATT')).status,'synced');
});

test('runner respeita backoff e limite de tentativas sem loop agressivo',async()=>{
  const kv=memoryKv(),outbox=createOutbox(kv,{maxAttempts:3});
  await outbox.enqueue({id:'Q-FAIL',operationId:'OP-FAIL',kind:'customer.create',payload:{name:'Ana'}});
  const api={async create(){throw new TypeError('offline');}};
  await runOutbox({outbox,api,now:()=>new Date('2026-09-27T20:00:00.000Z'),baseRetryMs:1000});
  const failed=await outbox.get('Q-FAIL');
  assert.equal(failed.status,'failed');assert.equal(failed.attempts,1);assert.match(failed.nextRetryAt,/20:00:01/);
  const skipped=await runOutbox({outbox,api,now:()=>new Date('2026-09-27T20:00:00.500Z'),baseRetryMs:1000});
  assert.equal(skipped.attempted,0);
});
