import test from 'node:test';
import assert from 'node:assert/strict';
import { getResourceDefinition } from '../cloudflare/api/resource-map.mjs';
import { createCloudSync } from '../src/sync/cloud-sync.mjs';
import { createCacheStore } from '../src/storage/cache-store.mjs';
import { PWA_NAV } from '../src/cloud/ui/common.mjs';

function memoryKv(){const values=new Map();return{async get(key){return values.has(String(key))?values.get(String(key)):null;},async set(key,value){values.set(String(key),String(value));return true;},async remove(key){values.delete(String(key));return true;},async flush(){return true;}};}

const expected=[
  ['ledger','finance.read'],['billingPlans','billing.read'],['collectionActions','billing.read'],
  ['contractTemplates','contracts.read'],['issuedContracts','contracts.read'],
  ['inspectionItems','inspection.read'],['alertState','alerts.read'],['attachments','documents.read']
];

test('parity read model exposes all daily-operation resources as safe GET models',()=>{
  for(const [name,permission] of expected){const def=getResourceDefinition(name);assert.ok(def,`${name} definition missing`);assert.equal(def.readPermission,permission);assert.deepEqual(def.collectionMethods,['GET']);assert.deepEqual(def.itemMethods,['GET']);assert.deepEqual(def.writable,{});}
});

test('cloud delta cache understands the new parity entities',async()=>{
  const store=memoryKv(),cache=createCacheStore({store});let cursor=0;
  const api={async request(path){assert.match(path,/\/api\/v1\/sync\/changes/);if(cursor++)return{changes:[],cursor:7,hasMore:false};return{cursor:7,hasMore:false,changes:[
    {entityType:'billingPlan',entityId:'PLAN-1',operation:'create',payload:{id:'PLAN-1',amount:100}},
    {entityType:'collectionAction',entityId:'COL-1',operation:'create',payload:{id:'COL-1',note:'Ligação'}},
    {entityType:'contractTemplate',entityId:'TPL-1',operation:'create',payload:{id:'TPL-1',name:'Padrão'}},
    {entityType:'issuedContract',entityId:'ISS-1',operation:'create',payload:{id:'ISS-1',rentalId:'LOC-1'}},
    {entityType:'alertState',entityId:'ALT-1',operation:'update',payload:{id:'ALT-1',stateJson:'{}'}},
    {entityType:'ledger',entityId:'FIN-1',operation:'create',payload:{id:'FIN-1',kind:'receivable',amount:100}},
    {entityType:'inspectionItem',entityId:'ITM-1',operation:'create',payload:{id:'ITM-1',inspectionId:'INSP-1',done:1}}
  ]};}};
  const sync=createCloudSync({api,cache,store}),pulled=await sync.pullChanges();assert.equal(pulled.applied,7);
  assert.equal((await cache.getResource('billingPlans'))[0].id,'PLAN-1');assert.equal((await cache.getResource('collectionActions'))[0].id,'COL-1');assert.equal((await cache.getResource('contractTemplates'))[0].id,'TPL-1');assert.equal((await cache.getResource('issuedContracts'))[0].id,'ISS-1');assert.equal((await cache.getResource('alertState'))[0].id,'ALT-1');assert.equal((await cache.getResource('ledger'))[0].id,'FIN-1');assert.equal((await cache.getResource('inspectionItems'))[0].id,'ITM-1');
});

test('PWA navigation includes all 12 approved operational modules',()=>{
  assert.deepEqual(PWA_NAV.map(item=>item.label),['Visão geral','Clientes','Frota','Locações','Vistorias','Financeiro','Cobranças','Inadimplência','Contratos','Documentos','Alertas','Manutenção']);
});
