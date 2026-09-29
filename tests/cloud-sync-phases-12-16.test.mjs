import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require=createRequire(import.meta.url);
const {assessCloudFirstMigration,prepareMigrationTables,MIGRATION_TABLES}=require('../electron/migration/cloud-first-migration.cjs');

function dataset(overrides={}){return{
  customers:[],vehicles:[],rentals:[],rental_payments:[],expenses:[],inspections:[],inspection_items:[],maintenance:[],
  audit_log:[],alert_state:[],app_settings:[],ledger:[],contract_templates:[],issued_contracts:[],billing_plans:[],
  billing_installments:[],billing_payments:[],billing_payment_conflicts:[],collection_actions:[],attachments:[],
  ...overrides
};}

test('fase 12: API client lista/revoga dispositivos e sessões pelos endpoints administrativos',async()=>{
  const {createApiClient}=await import('../src/api/client.mjs');
  const calls=[];
  const api=createApiClient({baseUrl:'https://cloud.example',maxRetries:0,fetchImpl:async(url,options={})=>{
    calls.push({url:String(url),method:options.method||'GET'});
    if(String(url).endsWith('/api/v1/devices'))return new Response(JSON.stringify({ok:true,devices:[{id:'PC-1',active:1}]}),{status:200,headers:{'content-type':'application/json'}});
    return new Response(JSON.stringify({ok:true,revoked:1}),{status:200,headers:{'content-type':'application/json'}});
  }});
  assert.equal((await api.listDevices())[0].id,'PC-1');
  await api.revokeDevice('PC-2');
  await api.revokeOtherSessions();
  await api.revokeAllSessions();
  assert.deepEqual(calls,[
    {url:'https://cloud.example/api/v1/devices',method:'GET'},
    {url:'https://cloud.example/api/v1/devices/PC-2/revoke',method:'POST'},
    {url:'https://cloud.example/api/v1/sessions/revoke-others',method:'POST'},
    {url:'https://cloud.example/api/v1/sessions/revoke-all',method:'POST'}
  ]);
});

test('fase 13/15: preflight diferencia PC novo, seed de nuvem, estado pronto e divergência bloqueada',()=>{
  const empty=dataset();
  const local=dataset({customers:[{id:'CUS-LOCAL'}]});
  const cloud=dataset({vehicles:[{id:'VEI-CLOUD'}]});
  assert.equal(assessCloudFirstMigration({localDataset:empty,cloudSnapshot:cloud,replicaState:{initialized:false}}).mode,'new-device');
  assert.equal(assessCloudFirstMigration({localDataset:local,cloudSnapshot:empty,replicaState:{initialized:false}}).mode,'seed-cloud');
  assert.equal(assessCloudFirstMigration({localDataset:local,cloudSnapshot:cloud,replicaState:{initialized:false}}).mode,'blocked');
  assert.equal(assessCloudFirstMigration({localDataset:local,cloudSnapshot:cloud,replicaState:{initialized:true}}).mode,'ready');
});

test('fase 15: payload de migração não inclui credenciais/sessões nem metadata local de anexos',()=>{
  const local=dataset({
    customers:[{id:'CUS-1',installation_id:'OLD',name:'Cliente'}],
    rentals:[{id:'LOC-1',installation_id:'OLD',attendant_id:'USR-LEGACY'}],
    attachments:[{id:'ATT-1',installation_id:'OLD',local_path:'C:/dados/foto.jpg'}],
    users:[{id:'USR-LEGACY',password_hash:'secret'}],sessions:[{id:'SES-1'}],device_credentials:[{id:'CRED-1'}]
  });
  const tables=prepareMigrationTables(local,{installationId:'LOCADORA-GEORGE',actorId:'USR-CLOUD'});
  assert.deepEqual(Object.keys(tables),MIGRATION_TABLES);
  assert.equal(tables.customers[0].installation_id,'LOCADORA-GEORGE');
  assert.equal(tables.rentals[0].attendant_id,'USR-CLOUD');
  assert.equal(Object.hasOwn(tables,'users'),false);
  assert.equal(Object.hasOwn(tables,'attachments'),false);
  assert.equal(Object.hasOwn(tables,'sessions'),false);
  assert.equal(Object.hasOwn(tables,'device_credentials'),false);
});

test('fase 12/15: renderer recebe controles administrativos sem cookie ou token',()=>{
  const main=fs.readFileSync(new URL('../electron/main.cjs',import.meta.url),'utf8');
  const preload=fs.readFileSync(new URL('../electron/preload.cjs',import.meta.url),'utf8');
  assert.match(main,/locadora:cloud-devices:list/);
  assert.match(main,/locadora:cloud-devices:revoke/);
  assert.match(main,/locadora:cloud-sessions:revoke-others/);
  assert.match(main,/locadora:migration:status/);
  assert.match(main,/locadora:migration:seed/);
  assert.match(main,/locadora:migration:adopt-cloud/);
  assert.match(preload,/cloudDevicesList/);
  assert.match(preload,/cloudDeviceRevoke/);
  assert.match(preload,/cloudSessionsRevokeOthers/);
  assert.match(preload,/migrationStatus/);
  assert.match(preload,/migrationSeed/);
  assert.match(preload,/migrationAdoptCloud/);
  assert.doesNotMatch(preload,/cookie|deviceTokenEncrypted|replicaCredential/);
});

test('fase 12: administração exibe dispositivos e revogação de outras sessões',()=>{
  const ui=fs.readFileSync(new URL('../src/ui/system.mjs',import.meta.url),'utf8');
  assert.match(ui,/Dispositivos e sessões/);
  assert.match(ui,/Revogar outras sessões/);
  assert.match(ui,/data-device-revoke/);
});

test('fase 15: administração mostra migração segura e nunca oferece sobrescrita silenciosa',()=>{
  const ui=fs.readFileSync(new URL('../src/ui/system.mjs',import.meta.url),'utf8');
  assert.match(ui,/Migração para a nuvem/);
  assert.match(ui,/Enviar dados deste PC/);
  assert.match(ui,/Usar dados da nuvem neste PC/);
  assert.match(ui,/backup verificado/i);
  assert.doesNotMatch(ui,/sobrescrever automaticamente/i);
});

test('fase 16: manual e runbook descrevem D1/R2, mesma conta, offline e recuperação',()=>{
  const manual=fs.readFileSync(new URL('../docs/runbooks/manual-operacao-cloud.md',import.meta.url),'utf8');
  const migration=fs.readFileSync(new URL('../docs/runbooks/migracao-versao-cloud.md',import.meta.url),'utf8');
  const dr=fs.readFileSync(new URL('../docs/runbooks/cloud-disaster-recovery.md',import.meta.url),'utf8');
  for(const text of [manual,migration,dr]){
    assert.match(text,/D1/);
    assert.match(text,/R2/);
  }
  assert.match(manual,/mesma conta/i);
  assert.match(manual,/offline/i);
  assert.match(dr,/novo PC/i);
  assert.match(migration,/backup verificado/i);
  assert.doesNotMatch(manual,/pareamento|192\.168\.|mesma rede Wi-Fi/i);
});
