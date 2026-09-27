import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncClient,SYNC_CONFLICT_KEY } from '../src/sync/client.mjs';

class MemoryStore{constructor(){this.map=new Map()}async get(k){return this.map.has(k)?this.map.get(k):null}async set(k,v){this.map.set(k,String(v));return true}async remove(k){this.map.delete(k);return true}async flush(){}}

test('P2 client salva configuração e aplica pull preservando cópia local em conflito',async()=>{
  const store=new MemoryStore(),calls=[];
  const fetchImpl=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({ok:true,action:'pull',conflict:true,revision:3,snapshot:{version:3,updatedAt:'2026-09-14T10:10:00Z',value:'remote'}}),{status:200,headers:{'content-type':'application/json'}})};
  const client=createSyncClient({store,fetchImpl,deviceId:'PHONE-1'});await client.init();
  client.configure({serverUrl:'http://192.168.0.10:4174/',token:'ABC',enabled:true,autoSync:true,deviceName:'Celular'});await client.flush();
  const local={version:3,updatedAt:'2026-09-14T10:00:00Z',value:'local'};
  const result=await client.sync(local);
  assert.equal(result.snapshot.value,'remote');assert.equal(result.meta.revision,3);assert.equal(result.meta.lastDirection,'pull');
  assert.equal(JSON.parse(await store.get(SYNC_CONFLICT_KEY)).value,'local');
  assert.equal(calls[0].options.headers['x-locadora-sync-token'],'ABC');assert.equal(JSON.parse(calls[0].options.body).deviceId,'PHONE-1');
});

test('P2 client mantém dados locais e registra erro quando PC está offline',async()=>{
  const store=new MemoryStore(),client=createSyncClient({store,fetchImpl:async()=>{throw new Error('offline')},deviceId:'PC-1'});await client.init();
  client.configure({serverUrl:'http://127.0.0.1:4174',token:'ABC',enabled:true});await client.flush();
  const local={version:3,updatedAt:'2026-09-14T10:00:00Z',value:'local'},result=await client.sync(local);
  assert.equal(result.snapshot.value,'local');assert.equal(result.ok,false);assert.equal(result.meta.lastError,'offline');
});
