import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncClient,SYNC_OFFLINE_KEY } from '../src/sync/client.mjs';

function memoryStore(){const map=new Map();return{get:async k=>map.has(k)?map.get(k):null,set:async(k,v)=>{map.set(k,String(v));return true},remove:async k=>{map.delete(k);return true},flush:async()=>{},map};}

test('sync client: alteração local fica pendente mesmo sem rede',async()=>{
  const store=memoryStore(),client=createSyncClient({store,fetchImpl:async()=>{throw new Error('offline')},deviceId:'DEV-1'});await client.init();
  const snapshot={version:3,updatedAt:'2026-09-14T12:00:00.000Z'};client.markDirty(snapshot);await client.flush();
  assert.equal(client.offlineState().dirty,true);assert.equal(client.offlineState().pending.length,1);assert.ok(await store.get(SYNC_OFFLINE_KEY));
});

test('sync client: sync bem sucedido limpa pendência offline',async()=>{
  const store=memoryStore(),fetchImpl=async()=>({ok:true,json:async()=>({action:'push',revision:4,conflict:false})});
  const client=createSyncClient({store,fetchImpl,deviceId:'DEV-1'});await client.init();client.configure({serverUrl:'http://192.168.0.2:4174',token:'abc',enabled:true});
  const snapshot={version:3,updatedAt:'2026-09-14T12:00:00.000Z'};client.markDirty(snapshot);const result=await client.sync(snapshot);
  assert.equal(result.ok,true);assert.equal(client.offlineState().dirty,false);assert.equal(client.offlineState().pending.length,0);assert.equal(client.offlineState().lastSyncedRevision,4);
});

test('sync client: falha de rede mantém snapshot na fila',async()=>{
  const store=memoryStore(),client=createSyncClient({store,fetchImpl:async()=>{throw new Error('sem rede')},deviceId:'DEV-1'});await client.init();client.configure({serverUrl:'http://192.168.0.2:4174',token:'abc',enabled:true});
  const snapshot={version:3,updatedAt:'2026-09-14T12:00:00.000Z'};client.markDirty(snapshot);const result=await client.sync(snapshot);
  assert.equal(result.ok,false);assert.equal(client.offlineState().dirty,true);assert.equal(client.offlineState().pending.length,1);
});
