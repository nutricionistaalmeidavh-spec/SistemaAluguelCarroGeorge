import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createOutbox } from '../src/sync/outbox.mjs';

const require=createRequire(import.meta.url);
const {createDesktopCloudSyncController}=require('../electron/cloud-sync-controller.cjs');

function memoryKv(){const values=new Map();return{async get(key){return values.get(String(key))??null;},async set(key,value){values.set(String(key),String(value));return true;},async remove(key){values.delete(String(key));return true;},async flush(){return true;}};}

test('fase 7: conflito preserva payload local e versão atual da nuvem até resolução explícita',async()=>{
  const outbox=createOutbox(memoryKv());
  await outbox.enqueue({id:'Q-1',operationId:'OP-1',kind:'customer.update',payload:{id:'CUS-1',data:{name:'Local'},expectedVersion:1}});
  await outbox.markConflict('Q-1',{code:'version_conflict',status:409,details:{current:{id:'CUS-1',name:'Nuvem',version:2}}});
  const [conflict]=await outbox.list({statuses:['conflict']});
  assert.equal(conflict.payload.data.name,'Local');
  assert.equal(conflict.lastError.details.current.name,'Nuvem');
  const resolved=await outbox.resolveConflict('Q-1',{strategy:'accept-cloud'});
  assert.equal(resolved.status,'synced');
  assert.equal(resolved.result.resolution,'accept-cloud');
  assert.equal(resolved.result.conflict.details.current.version,2);
  assert.equal((await outbox.summary()).conflict,0);
});

test('fase 7: não existe force overwrite para conflito financeiro ou versionado',async()=>{
  const outbox=createOutbox(memoryKv());
  await outbox.enqueue({id:'Q-PAY',operationId:'OP-PAY',kind:'billing.payment',payload:{installmentId:'PAR-1',amount:100}});
  await outbox.markConflict('Q-PAY',{code:'version_conflict',status:409,details:{current:{id:'PAR-1',version:4}}});
  await assert.rejects(()=>outbox.resolveConflict('Q-PAY',{strategy:'keep-local'}),/unsupported_conflict_resolution/);
  assert.equal((await outbox.get('Q-PAY')).status,'conflict');
});

test('fase 7: controller lista conflitos e aceitar nuvem puxa estado canônico',async()=>{
  const outbox=createOutbox(memoryKv());
  await outbox.enqueue({id:'Q-2',operationId:'OP-2',kind:'vehicle.update',payload:{id:'VEI-1',data:{color:'Preto'},expectedVersion:1}});
  await outbox.markConflict('Q-2',{code:'version_conflict',status:409,details:{current:{id:'VEI-1',color:'Branco',version:2}}});
  let pulls=0;
  const controller=createDesktopCloudSyncController({outbox,runOutbox:async()=>({synced:0}),api:{},authenticated:()=>true,pull:async()=>{pulls++;}});
  assert.equal((await controller.conflicts()).length,1);
  const result=await controller.resolveConflict('Q-2',{strategy:'accept-cloud'});
  assert.equal(result.item.status,'synced');
  assert.equal(pulls,1);
});

test('fases 8 e 10: desktop expõe somente status cloud e não depende do sync LAN',()=>{
  const main=fs.readFileSync(new URL('../electron/main.cjs',import.meta.url),'utf8');
  const preload=fs.readFileSync(new URL('../electron/preload.cjs',import.meta.url),'utf8');
  const app=fs.readFileSync(new URL('../src/app.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(main,/sync-server\.cjs|startSyncServer|locadora:sync-info|pairingUrls|lanAddresses|syncInfo\.localUrl/);
  assert.match(main,/loadFile\(/);
  assert.match(main,/locadora:cloud-sync:conflicts/);
  assert.match(main,/locadora:cloud-sync:resolve-conflict/);
  assert.doesNotMatch(preload,/getSyncInfo|locadora:sync-info/);
  assert.match(preload,/cloudSyncConflicts/);
  assert.match(preload,/cloudSyncResolveConflict/);
  assert.match(preload,/input\?\.strategy\?\?input\?\?['"]accept-cloud['"]/);
  assert.doesNotMatch(app,/createSyncClient|renderSync|PC ↔ Mobile|pair=|serverUrl|syncClient/);
  assert.match(app,/cloudSyncStatus/);
  assert.match(app,/Nuvem/);
});

test('fase 8: gravação desktop continua local-first e enfileira cloud sem depender de LAN',()=>{
  const main=fs.readFileSync(new URL('../electron/main.cjs',import.meta.url),'utf8');
  assert.match(main,/relationalStore\.saveSnapshot\(snapshot\)/);
  assert.match(main,/buildCloudOperations\(before,snapshot\)/);
  assert.match(main,/enqueueOperations\(operations\)/);
  assert.match(main,/cloudAuth\?\.status\?\.\(\)\.authenticated/);
});

test('fase 9: PWA declara sessão offline não validada, conserva fila/blob e sincroniza no evento online',()=>{
  const cloud=fs.readFileSync(new URL('../src/cloud-app.mjs',import.meta.url),'utf8');
  const sw=fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8');
  assert.match(cloud,/_offlineSession:true/);
  assert.match(cloud,/Sessão local/);
  assert.match(cloud,/window\.addEventListener\(['"]online['"]/);
  assert.match(cloud,/flushPending\(repository,runtime\)/);
  assert.match(cloud,/runtime\.blobs\.put/);
  assert.match(sw,/caches\.open/);
  assert.match(sw,/url\.pathname\.startsWith\(['"]\/api\/['"]\)/);
});

test('fases 10 e 11: UI e runtime de pareamento LAN deixam de ser produção',()=>{
  const app=fs.readFileSync(new URL('../src/app.mjs',import.meta.url),'utf8');
  const main=fs.readFileSync(new URL('../electron/main.cjs',import.meta.url),'utf8');
  const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.doesNotMatch(app,/Sincronização local|Token de pareamento|Servidor do PC|Abrir no celular/);
  assert.doesNotMatch(main,/4174|x-locadora-sync-token|legacySnapshotSync/);
  assert.ok(!pkg.scripts.check.includes('src/ui/p2.mjs'));
});
