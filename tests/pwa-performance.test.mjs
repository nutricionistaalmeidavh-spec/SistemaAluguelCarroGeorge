import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createApiClient } from '../src/api/client.mjs';
import { createCacheStore } from '../src/storage/cache-store.mjs';
import { createCloudRepository } from '../src/storage/cloud-repository.mjs';
import { resourcesForMutation,resourcesForView } from '../src/cloud-app.mjs';

const admin={id:'USR-1',role:'admin',active:true};

function memoryStore(){
  const values=new Map();let batches=0;
  return{
    get batches(){return batches;},
    async get(key){return values.has(String(key))?values.get(String(key)):null;},
    async set(key,value){values.set(String(key),String(value));return true;},
    async remove(key){values.delete(String(key));return true;},
    async setMany(entries){batches++;for(const entry of entries){const key=String(entry.key);if(entry.value==null)values.delete(key);else values.set(key,String(entry.value));}return true;},
    async flush(){return true;}
  };
}

test('cada módulo do PWA carrega somente os recursos de que precisa',()=>{
  assert.deepEqual(resourcesForView('customers',admin),['customers']);
  assert.deepEqual(resourcesForView('vehicles',admin),['vehicles']);
  const finance=resourcesForView('finance',admin);
  assert.deepEqual(finance,['vehicles','expenses'],'financeiro deve buscar KPIs e recebíveis por endpoints agregados e hidratar apenas o necessário para despesas');
  assert.deepEqual(resourcesForView('overview',admin),[],'dashboard deve ser agregado no D1 sem baixar coleções completas');
});

test('mutações com efeitos derivados invalidam somente os recursos afetados',()=>{
  assert.deepEqual(resourcesForMutation('rental.create',admin),['rentals','ledger','billingPlans','billingInstallments']);
  assert.deepEqual(resourcesForMutation('billing.payment',admin),['billingInstallments','billingPayments','rentals','ledger']);
  assert.deepEqual(resourcesForMutation('maintenance.complete',admin),['maintenance','vehicles','expenses','ledger']);
});

test('refresh cloud busca recursos independentes em paralelo e persiste em um único lote',async()=>{
  const store=memoryStore(),cache=createCacheStore({store}),started=[];let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const api={async list(name){started.push(name);await gate;return[{id:`${name}-1`}];}};
  const repo=createCloudRepository({api,cache});
  const pending=repo.refresh(['customers','vehicles']);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(new Set(started),new Set(['customers','vehicles']));
  release();
  const result=await pending;
  assert.equal(result.customers[0].id,'customers-1');
  assert.equal(result.vehicles[0].id,'vehicles-1');
  assert.equal(store.batches,1,'hidratação de uma tela deve gerar uma única persistência local em lote');
  assert.deepEqual(await repo.missingResources(['customers','vehicles']),[]);
});

test('cliente API percorre paginação limitada sem resposta D1 ilimitada',async()=>{
  const offsets=[];
  const fetchImpl=async input=>{
    const url=new URL(String(input));const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||0);offsets.push([offset,limit]);
    const payload=offset===0
      ?{ok:true,items:[{id:'A'},{id:'B'}],pagination:{limit,offset:0,nextOffset:2,hasMore:true}}
      :{ok:true,items:[{id:'C'}],pagination:{limit,offset:2,nextOffset:null,hasMore:false}};
    return new Response(JSON.stringify(payload),{status:200,headers:{'content-type':'application/json'}});
  };
  const api=createApiClient({baseUrl:'https://example.test',fetchImpl,maxRetries:0});
  const items=await api.list('customers',{pageSize:2});
  assert.deepEqual(items.map(item=>item.id),['A','B','C']);
  assert.deepEqual(offsets,[[0,2],[2,2]]);
});

test('bootstrap de autenticação não bloqueia o import principal do PWA',async()=>{
  const source=await readFile(new URL('../src/bootstrap.mjs',import.meta.url),'utf8');
  assert.match(source,/void fetch\('\/api\/v1\/auth\/bootstrap'/);
  assert.doesNotMatch(source,/await fetch\('\/api\/v1\/auth\/bootstrap'/);
  assert.match(source,/await import\('\.\/app\.mjs'\)/);
});

test('service worker invalida a geração anterior do cache estático',async()=>{
  const source=await readFile(new URL('../sw.js',import.meta.url),'utf8');
  assert.match(source,/0\.7\.0-cloud-mobile-7/);
});
