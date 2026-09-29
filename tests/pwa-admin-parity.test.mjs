import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { PWA_NAV, navigationFor } from '../src/cloud/ui/common.mjs';
import { createApiClient } from '../src/api/client.mjs';
import { getResourceDefinition } from '../cloudflare/api/resource-map.mjs';
import { handleBackupRoute } from '../cloudflare/api/backup-routes.mjs';
import { hashPassword } from '../cloudflare/auth/password.mjs';
import { FakeD1 } from './helpers/fake-d1.mjs';
import { FakeR2 } from './helpers/fake-r2.mjs';

const ADMIN_ROUTE_URL=new URL('../cloudflare/api/admin-routes.mjs',import.meta.url);
const admin={id:'USR-ADMIN',userId:'USR-ADMIN',installationId:'INST-ADMIN',role:'admin',active:true,deviceId:'WEB-ADMIN',sessionId:'SES-ADMIN'};
const attendant={id:'USR-ATD',role:'atendente',active:true};
function jsonRequest(path,{method='GET',body}={}){return new Request(`https://locadora.test${path}`,{method,headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});}
async function seedAdmin(db,{password='SenhaSegura123!'}={}){const now='2026-09-29T20:00:00.000Z',passwordHash=await hashPassword(password,{iterations:1});db.sqlite.prepare('INSERT INTO installations (id,name,created_at,updated_at) VALUES (?,?,?,?)').run(admin.installationId,'George',now,now);db.sqlite.prepare('INSERT INTO users (id,installation_id,username,name,role,active,password_hash,must_change_password,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(admin.userId,admin.installationId,'george@teste.local','George','admin',1,passwordHash,0,now,now);return{now,password};}

test('Administração aparece somente para administrador no PWA',()=>{assert.ok(PWA_NAV.some(item=>item.id==='administration'),'módulo administration ausente');assert.ok(navigationFor(admin).some(item=>item.id==='administration'));assert.ok(!navigationFor(attendant).some(item=>item.id==='administration'));});
test('ApiClient expõe contratos administrativos cloud',()=>{const api=createApiClient({fetchImpl:async()=>new Response(JSON.stringify({ok:true}),{status:200,headers:{'content-type':'application/json'}})});for(const name of ['getAdminAudit','getAdminSettings','updateAdminSettings','listCloudBackups','createCloudBackup','restoreCloudBackup','listDevices','revokeDevice','revokeOtherSessions','revokeAllSessions'])assert.equal(typeof api[name],'function',`${name} ausente`);});
test('configurações da empresa são leitura cloud segura para as telas operacionais',()=>{const definition=getResourceDefinition('appSettings');assert.ok(definition,'appSettings ausente');assert.equal(definition.readPermission,'rental.read');assert.deepEqual(definition.collectionMethods,['GET']);assert.deepEqual(definition.itemMethods,[]);});

test('restore cloud exige confirmação explícita e senha antes de acessar o backup',async()=>{const db=new FakeD1(),r2=new FakeR2();try{const {password}=await seedAdmin(db),env={DB:db,ATTACHMENTS:r2};const missing=await handleBackupRoute(jsonRequest('/api/v1/backups/BKP-1/restore',{method:'POST',body:{}}),env,{}, {auth:admin});assert.equal(missing.status,400);assert.equal((await missing.json()).error,'restore_confirmation_required');const wrong=await handleBackupRoute(jsonRequest('/api/v1/backups/BKP-1/restore',{method:'POST',body:{confirmation:'RESTAURAR',password:`${password}-errada`}}),env,{}, {auth:admin});assert.equal(wrong.status,403);assert.equal((await wrong.json()).error,'invalid_credentials');}finally{db.close();}});

test('API administrativa lista auditoria filtrada, atualiza configurações e publica delta',async()=>{
  assert.equal(existsSync(ADMIN_ROUTE_URL),true,'cloudflare/api/admin-routes.mjs ainda não existe');const { handleAdminRoute }=await import(ADMIN_ROUTE_URL.href);const db=new FakeD1();
  try{
    const {now}=await seedAdmin(db);
    db.sqlite.prepare('INSERT INTO audit_log (id,installation_id,actor_id,action,entity_type,entity_id,details_json,at,created_at,updated_at,version) VALUES (?,?,?,?,?,?,?,?,?,?,1)').run('AUD-1',admin.installationId,admin.userId,'customer.create','customer','CUS-1','{}',now,now,now);
    db.sqlite.prepare('INSERT INTO audit_log (id,installation_id,actor_id,action,entity_type,entity_id,details_json,at,created_at,updated_at,version) VALUES (?,?,?,?,?,?,?,?,?,?,1)').run('AUD-2',admin.installationId,admin.userId,'vehicle.create','vehicle','VEI-1','{}','2026-09-29T19:00:00.000Z',now,now);
    db.sqlite.prepare('INSERT INTO app_settings (installation_id,settings_json,updated_at,version) VALUES (?,?,?,1)').run(admin.installationId,JSON.stringify({companyName:'George Locações',phone:'16999999999'}),now);
    const auditResponse=await handleAdminRoute(jsonRequest('/api/v1/admin/audit?action=customer.create&limit=10&offset=0'),{DB:db},{},{auth:admin});assert.equal(auditResponse.status,200);const auditBody=await auditResponse.json();assert.equal(auditBody.items.length,1);assert.equal(auditBody.items[0].action,'customer.create');assert.equal(auditBody.items[0].actorName,'George');assert.equal(auditBody.pagination.limit,10);
    const settingsResponse=await handleAdminRoute(jsonRequest('/api/v1/admin/settings'),{DB:db},{},{auth:admin});assert.equal(settingsResponse.status,200);const settingsBody=await settingsResponse.json();assert.equal(settingsBody.settings.companyName,'George Locações');assert.equal(settingsBody.version,1);
    const updateResponse=await handleAdminRoute(jsonRequest('/api/v1/admin/settings',{method:'PATCH',body:{expectedVersion:1,data:{companyName:'Locadora George',document:'12345678900',phone:'16888888888',address:'Rua Teste, 1'}}}),{DB:db},{},{auth:admin});assert.equal(updateResponse.status,200);const updated=await updateResponse.json();assert.equal(updated.settings.companyName,'Locadora George');assert.equal(updated.version,2);
    assert.equal(db.scalar('SELECT COUNT(*) FROM sync_changes WHERE installation_id=? AND entity_type=?',admin.installationId,'appSettings'),1);
    const denied=await handleAdminRoute(jsonRequest('/api/v1/admin/settings'),{DB:db},{},{auth:{...attendant,userId:'USR-ATD',installationId:admin.installationId}});assert.equal(denied.status,403);
  }finally{db.close();}
});
