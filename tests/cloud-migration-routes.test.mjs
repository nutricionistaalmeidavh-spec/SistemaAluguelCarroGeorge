import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeD1 } from './helpers/fake-d1.mjs';
import { FakeR2 } from './helpers/fake-r2.mjs';
import { handleMigrationRoute } from '../cloudflare/api/migration-routes.mjs';

function setup(){
  const db=new FakeD1(),bucket=new FakeR2(),now='2026-09-29T12:00:00.000Z';
  const installationId='LOCADORA-GEORGE',userId='USR-CLOUD',deviceId='GEORGE-PC';
  db.sqlite.prepare('INSERT INTO installations (id,name,created_at,updated_at) VALUES (?,?,?,?)').run(installationId,'George',now,now);
  db.sqlite.prepare('INSERT INTO devices (id,installation_id,name,kind,active,last_seen_at,created_at,updated_at) VALUES (?,?,?,?,1,?,?,?)').run(deviceId,installationId,'PC George','desktop',now,now,now);
  db.sqlite.prepare('INSERT INTO users (id,installation_id,username,name,role,active,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)').run(userId,installationId,'george@example.test','George','admin',now,now);
  db.sqlite.prepare('INSERT INTO sessions (id,installation_id,user_id,token_hash,device_id,created_at,last_seen_at,expires_at) VALUES (?,?,?,?,?,?,?,?)').run('SES-KEEP',installationId,userId,'hash-keep',deviceId,now,now,'2027-09-29T12:00:00.000Z');
  return{db,bucket,env:{DB:db,ATTACHMENTS:bucket},auth:{installationId,userId,deviceId,role:'admin',active:true,sessionId:'SES-KEEP'},installationId,userId,deviceId};
}
function request(body){return new Request('https://example.test/api/v1/migration/import',{method:'POST',headers:{'content-type':'application/json','idempotency-key':'MIG-1'},body:JSON.stringify(body)});}

test('migração importa dataset local somente quando a nuvem de negócio está vazia e preserva sessão cloud',async()=>{
  const ctx=setup();
  try{
    const response=await handleMigrationRoute(request({tables:{
      customers:[{id:'CUS-LOCAL',installation_id:'OLD',name:'Cliente local',active:1,created_at:'2026-09-01T00:00:00.000Z',updated_at:'2026-09-01T00:00:00.000Z',version:1}],
      vehicles:[{id:'VEI-LOCAL',installation_id:'OLD',model:'Onix',plate:'ABC1D23',mileage:10,daily_rate:120,purchase_price:0,availability:'disponivel',created_at:'2026-09-01T00:00:00.000Z',updated_at:'2026-09-01T00:00:00.000Z',version:1}],
      rentals:[{id:'LOC-LOCAL',installation_id:'OLD',vehicle_id:'VEI-LOCAL',customer_id:'CUS-LOCAL',attendant_id:'USR-LEGACY',pickup_at:'2026-09-20T10:00:00.000Z',return_at:'2026-09-21T10:00:00.000Z',period_mode:'fixed',status:'reserva',daily_rate:120,days:1,total:120,billing_mode:'total',payment_status:'aberto',created_at:'2026-09-01T00:00:00.000Z',updated_at:'2026-09-01T00:00:00.000Z',version:1}]
    }},ctx.env,{}, {auth:ctx.auth});
    assert.equal(response.status,201);
    const payload=await response.json();
    assert.equal(payload.ok,true);
    assert.ok(payload.backupId);
    assert.equal(payload.restoreGeneration,1);
    assert.equal(ctx.db.scalar('SELECT COUNT(*) FROM customers WHERE installation_id=?',ctx.installationId),1);
    assert.equal(ctx.db.scalar('SELECT COUNT(*) FROM vehicles WHERE installation_id=?',ctx.installationId),1);
    assert.equal(ctx.db.scalar('SELECT COUNT(*) FROM rentals WHERE installation_id=?',ctx.installationId),1);
    assert.equal(ctx.db.scalar('SELECT COUNT(*) FROM sessions WHERE id=?','SES-KEEP'),1);
    assert.equal(ctx.db.sqlite.prepare('SELECT attendant_id FROM rentals WHERE id=?').get('LOC-LOCAL').attendant_id,ctx.userId);
  }finally{ctx.db.close();}
});

test('migração recusa nuvem já populada sem alterar dataset existente',async()=>{
  const ctx=setup();
  try{
    const now='2026-09-29T12:00:00.000Z';
    ctx.db.sqlite.prepare('INSERT INTO customers (id,installation_id,name,active,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('CUS-CLOUD',ctx.installationId,'Já na nuvem',1,now,now);
    const response=await handleMigrationRoute(request({tables:{customers:[{id:'CUS-LOCAL',name:'Local'}]}}),ctx.env,{}, {auth:ctx.auth});
    assert.equal(response.status,409);
    assert.equal((await response.json()).error,'migration_cloud_not_empty');
    assert.equal(ctx.db.scalar('SELECT COUNT(*) FROM customers WHERE installation_id=?',ctx.installationId),1);
    assert.equal(ctx.db.scalar('SELECT COUNT(*) FROM customers WHERE id=?','CUS-LOCAL'),0);
  }finally{ctx.db.close();}
});

test('migração é exclusiva de admin e nunca aceita users, sessions, credentials ou attachments no payload',async()=>{
  const ctx=setup();
  try{
    const forbidden=await handleMigrationRoute(request({tables:{customers:[]}}),ctx.env,{}, {auth:{...ctx.auth,role:'operador'}});
    assert.equal(forbidden.status,403);
    const invalid=await handleMigrationRoute(request({tables:{users:[{id:'BAD'}],sessions:[{id:'BAD'}],attachments:[{id:'BAD'}]}}),ctx.env,{}, {auth:ctx.auth});
    assert.equal(invalid.status,400);
    assert.equal((await invalid.json()).error,'migration_table_not_allowed');
  }finally{ctx.db.close();}
});
