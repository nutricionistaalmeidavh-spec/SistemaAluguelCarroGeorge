import test from 'node:test';
import assert from 'node:assert/strict';
import { routeApi } from '../cloudflare/api/router.mjs';
import { canCloud } from '../cloudflare/auth/permissions.mjs';

function recordingEnv(){
  const state={prepareCalls:0,sql:[]};
  const DB={
    prepare(sql){
      state.prepareCalls+=1;state.sql.push(sql);
      return{
        bind(){return this;},
        async all(){return{results:[]};},
        async first(){return null;},
        async run(){return{success:true,meta:{changes:1}};}
      };
    }
  };
  return{env:{DB},state};
}
function req(path,options={}){return new Request(`https://example.test${path}`,options);}

const admin={installationId:'INST-RBAC',userId:'USR-ADMIN',role:'admin',active:true};
const attendant={installationId:'INST-RBAC',userId:'USR-ATT',role:'atendente',active:true};
const inspector={installationId:'INST-RBAC',userId:'USR-INS',role:'vistoriador',active:true};

test('matriz cloud mantém permissões equivalentes aos papéis operacionais',()=>{
  assert.equal(canCloud(admin,'customer.write'),true);
  assert.equal(canCloud(attendant,'customer.read'),true);
  assert.equal(canCloud(attendant,'customer.write'),true);
  assert.equal(canCloud(attendant,'finance.write'),true);
  assert.equal(canCloud(inspector,'inspection.write'),true);
  assert.equal(canCloud(inspector,'vehicle.read'),true);
  assert.equal(canCloud(inspector,'customer.read'),false);
  assert.equal(canCloud(inspector,'finance.read'),false);
  assert.equal(canCloud({installationId:'I',userId:'U',role:'unknown',active:true},'rental.read'),false);
});

test('RBAC negado responde 403 antes de tocar no D1',async()=>{
  const {env,state}=recordingEnv();
  let response=await routeApi(req('/api/v1/customers'),env,{}, {auth:inspector});
  assert.equal(response.status,403);assert.equal(state.prepareCalls,0);
  response=await routeApi(req('/api/v1/customers',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Bloqueado'})}),env,{}, {auth:inspector});
  assert.equal(response.status,403);assert.equal(state.prepareCalls,0);
  response=await routeApi(req('/api/v1/customers'),env,{}, {auth:{installationId:'I',userId:'U',role:'unknown',active:true}});
  assert.equal(response.status,403);assert.equal(state.prepareCalls,0);
});

test('RBAC permitido consulta D1 somente após autorização',async()=>{
  const {env,state}=recordingEnv();
  const response=await routeApi(req('/api/v1/customers'),env,{}, {auth:attendant});
  assert.equal(response.status,200);
  assert.equal(state.prepareCalls,1);
  assert.match(state.sql[0],/installation_id\s*=\s*\?/i);
});
