import test from 'node:test';
import assert from 'node:assert/strict';
import { routeApi } from '../cloudflare/api/router.mjs';
import { createD1Repository } from '../cloudflare/db/d1-repository.mjs';

class RecordingD1 {
  constructor(results=[]){this.results=results;this.calls=[];}
  prepare(sql){
    const call={sql,params:[]};this.calls.push(call);
    const self=this;
    return {
      bind(...params){call.params=params;return this;},
      async all(){return{results:self.results.filter(row=>!call.params[0]||row.installation_id===call.params[0])};},
      async first(){return self.results.find(row=>row.installation_id===call.params[0]&&row.id===call.params[1])??null;},
      async run(){return{success:true,meta:{changes:1}};}
    };
  }
  async batch(statements){return statements.map(()=>({success:true,meta:{changes:1}}));}
}

const authA={installationId:'INST-A',userId:'USR-A',role:'admin'};
const authB={installationId:'INST-B',userId:'USR-B',role:'admin'};

function req(path,options={}){return new Request(`https://example.test${path}`,options);}

test('resource map expõe somente recursos previstos e bloqueia tabela arbitrária',async()=>{
  const env={DB:new RecordingD1()};
  let response=await routeApi(req('/api/v1/kv'),env,{}, {auth:authA});
  assert.equal(response.status,404);
  response=await routeApi(req('/api/v1/customers'),env,{}, {auth:null});
  assert.equal(response.status,401);
  response=await routeApi(req('/api/v1/rentals',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),env,{}, {auth:authA});
  assert.equal(response.status,405,'rental genérico não pode contornar regras de reserva');
});

test('D1 repository sempre isola list/get pela instalação autenticada',async()=>{
  const db=new RecordingD1([
    {id:'C-A',installation_id:'INST-A',name:'Cliente A',deleted_at:null},
    {id:'C-B',installation_id:'INST-B',name:'Cliente B',deleted_at:null}
  ]);
  const repoA=createD1Repository(db,'INST-A');
  const repoB=createD1Repository(db,'INST-B');
  assert.deepEqual((await repoA.list('customers')).map(row=>row.id),['C-A']);
  assert.deepEqual((await repoB.list('customers')).map(row=>row.id),['C-B']);
  assert.equal((await repoA.get('customers','C-B')),null);
  for(const call of db.calls){
    assert.match(call.sql,/installation_id\s*=\s*\?/i);
    assert.ok(['INST-A','INST-B'].includes(call.params[0]));
  }
});

test('router lista customers dentro da instalação e rejeita métodos não permitidos',async()=>{
  const env={DB:new RecordingD1([{id:'C-A',installation_id:'INST-A',name:'Cliente A',deleted_at:null}])};
  let response=await routeApi(req('/api/v1/customers'),env,{}, {auth:authA});
  assert.equal(response.status,200);
  assert.deepEqual((await response.json()).items.map(row=>row.id),['C-A']);
  response=await routeApi(req('/api/v1/customers',{method:'TRACE'}),env,{}, {auth:authA});
  assert.equal(response.status,405);
});
