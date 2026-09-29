import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { handleSyncRoute } from '../cloudflare/api/sync-routes.mjs';
import { FakeD1 } from './helpers/fake-d1.mjs';
import { relationalToSnapshot } from '../src/migration/relational-to-snapshot.mjs';
import { snapshotToRelational } from '../src/migration/snapshot-to-relational.mjs';

const require=createRequire(import.meta.url);
const {buildCloudOperations}=require('../electron/cloud-sync-operations.cjs');
const admin={userId:'USR-ADMIN',installationId:'INST-SET',role:'admin',active:true,deviceId:'PC-GEORGE'};

function snapshot(name='George',version=3){return{version:4,customers:[],vehicles:[],rentals:[],expenses:[],users:[],ledger:[],audit:[],inspections:[],maintenance:[],contractTemplates:[],issuedContracts:[],billingPlans:[],billingInstallments:[],collectionActions:[],alertState:{},settings:{companyName:name,document:'',phone:'',address:''},settingsSyncVersion:version,settingsUpdatedAt:'2026-09-29T20:00:00.000Z',updatedAt:'2026-09-29T20:00:00.000Z'};}
function request(operation){return new Request('https://locadora.test/api/v1/sync/operations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operations:[operation]})});}

test('desktop gera settings.update versionado quando configurações da empresa mudam',()=>{
  const before=snapshot('George',3),after=structuredClone(before);after.settings.companyName='Locadora George';after.settings.phone='16999999999';
  const operations=buildCloudOperations(before,after),settings=operations.find(item=>item.kind==='settings.update');
  assert.ok(settings,'settings.update ausente');
  assert.equal(settings.payload.id,'INST-SET');
  assert.equal(settings.payload.expectedVersion,3);
  assert.deepEqual(settings.payload.data,{companyName:'Locadora George',phone:'16999999999'});
  assert.match(settings.operationId,/^desktop:settings\.update:/);
});

test('metadata de versão das configurações sobrevive SQLite relacional ↔ snapshot',()=>{
  const original=snapshot('George Cloud',7),dataset=snapshotToRelational(original,{installationId:'INST-SET',deviceId:'PC-GEORGE'});
  assert.equal(dataset.app_settings[0].version,7);
  const restored=relationalToSnapshot(dataset);
  assert.equal(restored.settings.companyName,'George Cloud');
  assert.equal(restored.settingsSyncVersion,7);
});

test('sync/operations aplica settings.update com conflito otimista e publica delta',async()=>{
  const db=new FakeD1();
  try{
    const now='2026-09-29T20:00:00.000Z';
    db.sqlite.prepare('INSERT INTO installations (id,name,created_at,updated_at) VALUES (?,?,?,?)').run(admin.installationId,'George',now,now);
    db.sqlite.prepare('INSERT INTO app_settings (installation_id,settings_json,updated_at,version,updated_by_device) VALUES (?,?,?,?,?)').run(admin.installationId,JSON.stringify({companyName:'George',phone:''}),now,3,'WEB-OLD');
    const operation={operationId:'desktop:settings.update:INST-SET:v3:test',kind:'settings.update',baseVersion:3,payload:{id:admin.installationId,data:{companyName:'Locadora George',phone:'16999999999'},expectedVersion:3}};
    const response=await handleSyncRoute(request(operation),{DB:db},{},{auth:admin});
    assert.equal(response.status,200,await response.text());
    const row=db.sqlite.prepare('SELECT settings_json,version,updated_by_device FROM app_settings WHERE installation_id=?').get(admin.installationId);
    assert.equal(JSON.parse(row.settings_json).companyName,'Locadora George');
    assert.equal(row.version,4);
    assert.equal(row.updated_by_device,'PC-GEORGE');
    assert.equal(db.scalar('SELECT COUNT(*) FROM sync_changes WHERE installation_id=? AND entity_type=?',admin.installationId,'appSettings'),1);
    assert.equal(db.scalar('SELECT COUNT(*) FROM audit_log WHERE installation_id=? AND action=?',admin.installationId,'settings.update'),1);
  }finally{db.close();}
});
