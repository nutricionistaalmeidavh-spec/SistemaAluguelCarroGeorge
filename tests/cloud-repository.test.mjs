import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient, ApiError } from '../src/api/client.mjs';
import { createCacheStore } from '../src/storage/cache-store.mjs';
import { createCloudRepository } from '../src/storage/cloud-repository.mjs';
import { createRuntimeRepository, isCloudRuntime } from '../src/storage/repository.mjs';

function memoryKv(){
  const values=new Map();
  return{kind:'memory-test',async get(key){return values.has(key)?values.get(key):null;},async set(key,value){values.set(key,String(value));return true;},async remove(key){values.delete(key);return true;},dump(){return new Map(values);}};
}
function jsonResponse(body,status=200,headers={}){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}});}

test('api client usa same-origin/credentials include e serialização JSON estrita',async()=>{
  const calls=[];
  const fetchImpl=async(url,options)=>{calls.push({url,options});return jsonResponse({ok:true,items:[{id:'CUS-1',name:'Ana'}]});};
  const api=createApiClient({baseUrl:'https://app.example.test',fetchImpl});
  const items=await api.list('customers');
  assert.deepEqual(items,[{id:'CUS-1',name:'Ana'}]);
  assert.equal(calls[0].url,'https://app.example.test/api/v1/customers');
  assert.equal(calls[0].options.credentials,'include');
  assert.equal(calls[0].options.method,'GET');
  assert.equal(calls[0].options.headers.get('accept'),'application/json');
});

test('api client só repete mutação quando há operationId idempotente',async()=>{
  let attempts=0;
  const fetchImpl=async()=>{attempts++;if(attempts===1)throw new TypeError('network_down_after_send');return jsonResponse({ok:true,item:{id:'LOC-1',status:'reserva'}} ,201);};
  const api=createApiClient({fetchImpl,maxRetries:1,retryDelayMs:0});
  await assert.rejects(()=>api.request('/api/v1/customers',{method:'POST',body:{name:'Sem Chave'}}),/network_down_after_send/);
  assert.equal(attempts,1);
  attempts=0;
  const result=await api.request('/api/v1/rentals',{method:'POST',body:{customerId:'CUS-1'},operationId:'OP-1'});
  assert.equal(attempts,2);assert.equal(result.item.id,'LOC-1');
});

test('cache store sobrevive recriação e mantém versão recebida do servidor',async()=>{
  const kv=memoryKv(),a=createCacheStore({store:kv});
  await a.replaceResource('customers',[{id:'CUS-1',name:'Primeira',version:1}],{cursor:4});
  await a.setSession({user:{id:'USR-1',role:'admin'}});
  const b=createCacheStore({store:kv});
  assert.deepEqual(await b.getResource('customers'),[{id:'CUS-1',name:'Primeira',version:1}]);
  assert.deepEqual(await b.getResourceMeta('customers'),{cursor:4});
  assert.equal((await b.getSession()).user.id,'USR-1');
  await b.upsertResourceItem('customers',{id:'CUS-1',name:'Nova',version:2});
  await b.upsertResourceItem('customers',{id:'CUS-1',name:'Velha',version:1});
  assert.equal((await b.getResource('customers'))[0].name,'Nova');
});

test('query online atualiza cache; falha de rede devolve cache sem fingir sincronização',async()=>{
  const kv=memoryKv(),cache=createCacheStore({store:kv});
  await cache.replaceResource('customers',[{id:'CUS-CACHED',name:'Cache',version:1}]);
  let online=true;
  const api={async list(resource){assert.equal(resource,'customers');if(!online)throw new TypeError('offline');return[{id:'CUS-ONLINE',name:'Servidor',version:3}];}};
  const repo=createCloudRepository({api,cache});
  assert.deepEqual(await repo.query('customers'),[{id:'CUS-ONLINE',name:'Servidor',version:3}]);
  assert.deepEqual(await cache.getResource('customers'),[{id:'CUS-ONLINE',name:'Servidor',version:3}]);
  online=false;
  const stale=await repo.query('customers',{allowCachedOnError:true});
  assert.deepEqual(stale,[{id:'CUS-ONLINE',name:'Servidor',version:3}]);
  assert.equal(repo.status().online,false);assert.equal(repo.status().lastError,'offline');
});

test('mutation só altera cache após 2xx e conserva operationId',async()=>{
  const kv=memoryKv(),cache=createCacheStore({store:kv});
  await cache.replaceResource('customers',[{id:'CUS-1',name:'Antes',version:1}]);
  const calls=[];
  const api={async update(resource,id,data,{expectedVersion,operationId}={}){calls.push({resource,id,data,expectedVersion,operationId});throw new ApiError('version_conflict',{status:409,code:'version_conflict'});}};
  const repo=createCloudRepository({api,cache});
  await assert.rejects(()=>repo.mutate({type:'update',resource:'customers',id:'CUS-1',data:{name:'Depois'},expectedVersion:1,operationId:'OP-UPD'}),error=>error?.status===409);
  assert.equal((await cache.getResource('customers'))[0].name,'Antes');
  api.update=async(resource,id,data,options)=>{calls.push({resource,id,data,...options});return{id,name:data.name,version:2};};
  const saved=await repo.mutate({type:'update',resource:'customers',id:'CUS-1',data:{name:'Depois'},expectedVersion:1,operationId:'OP-UPD-2'});
  assert.equal(saved.name,'Depois');assert.equal((await cache.getResource('customers'))[0].version,2);assert.equal(calls.at(-1).operationId,'OP-UPD-2');
});

test('401 limpa sessão cacheada e sinaliza login obrigatório',async()=>{
  const kv=memoryKv(),cache=createCacheStore({store:kv});await cache.setSession({user:{id:'USR-1'}});
  const api={async list(){throw new ApiError('unauthorized',{status:401,code:'unauthorized'});}};
  const repo=createCloudRepository({api,cache});
  await assert.rejects(()=>repo.query('customers'),error=>error?.status===401);
  assert.equal(await cache.getSession(),null);assert.equal(repo.status().requiresLogin,true);
});

test('runtime publicado seleciona cloud repository sem exigir bridge Electron',async()=>{
  const documentRef={querySelector(selector){return selector==='meta[name="locadora-runtime"]'?{getAttribute(){return 'cloud';}}:null;}};
  assert.equal(isCloudRuntime(documentRef),true);
  const kv=memoryKv(),calls=[];
  const fetchImpl=async(url,options)=>{calls.push({url,options});return jsonResponse({ok:true,items:[]});};
  const repo=await createRuntimeRepository({documentRef,store:kv,baseUrl:'https://george.example.test',fetchImpl,maxRetries:0});
  assert.equal(repo.kind,'cloud');
  await repo.query('customers');
  assert.equal(calls[0].url,'https://george.example.test/api/v1/customers');
  assert.equal(calls[0].options.credentials,'include');
});
