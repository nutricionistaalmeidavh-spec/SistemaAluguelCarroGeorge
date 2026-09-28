import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { startSyncServer }=require('../electron/sync-server.cjs');
const { SqliteStore }=require('../electron/sqlite-store.cjs');

test('P2 LAN server autentica, serve PWA e sincroniza snapshot somente em compatibilidade explícita',async(t)=>{
  const dir=await mkdtemp(join(tmpdir(),'locadora-sync-'));await writeFile(join(dir,'index.html'),'<h1>Locadora</h1>');const store=new SqliteStore(join(dir,'locadora.sqlite'));
  const server=await startSyncServer({host:'127.0.0.1',port:0,token:'TOKEN123',rootDir:dir,store,legacySnapshotSync:true});
  t.after(async()=>{await server.close();store.close();await rm(dir,{recursive:true,force:true});});const base=`http://127.0.0.1:${server.port}`;
  const page=await fetch(base+'/');assert.equal(page.status,200);assert.match(await page.text(),/Locadora/);
  const unauthorized=await fetch(base+'/api/sync/exchange',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({baseRevision:0,snapshot:{updatedAt:'2026-09-14T10:00:00Z'}})});assert.equal(unauthorized.status,401);
  const push=await fetch(base+'/api/sync/exchange',{method:'POST',headers:{'content-type':'application/json','x-locadora-sync-token':'TOKEN123'},body:JSON.stringify({baseRevision:0,deviceId:'PC',snapshot:{version:3,updatedAt:'2026-09-14T10:00:00Z',value:'pc'}})});const pushed=await push.json();assert.equal(pushed.action,'push');assert.equal(pushed.revision,1);assert.equal(store.getJson('sync:server-state').revision,1);
  const pull=await fetch(base+'/api/sync/exchange',{method:'POST',headers:{'content-type':'application/json','x-locadora-sync-token':'TOKEN123'},body:JSON.stringify({baseRevision:0,deviceId:'PHONE',snapshot:{version:3,updatedAt:'2026-09-14T09:00:00Z',value:'phone'}})});const pulled=await pull.json();assert.equal(pulled.action,'pull');assert.equal(pulled.conflict,true);assert.equal(pulled.snapshot.value,'pc');
});

test('snapshot exchange legado fica desligado por padrão',async(t)=>{
  const dir=await mkdtemp(join(tmpdir(),'locadora-sync-off-'));await writeFile(join(dir,'index.html'),'<h1>Locadora</h1>');const store=new SqliteStore(join(dir,'locadora.sqlite')),server=await startSyncServer({host:'127.0.0.1',port:0,token:'TOKEN123',rootDir:dir,store});t.after(async()=>{await server.close();store.close();await rm(dir,{recursive:true,force:true});});
  const response=await fetch(`http://127.0.0.1:${server.port}/api/sync/exchange`,{method:'POST',headers:{'content-type':'application/json','x-locadora-sync-token':'TOKEN123'},body:'{}'});assert.equal(response.status,410);assert.equal((await response.json()).error,'legacy_sync_disabled');
});
