import { API_PREFIX } from '../config.mjs';
import { canCloud } from '../auth/permissions.mjs';
import { appendChangeStatement } from '../sync/change-log.mjs';
import { cleanupKnownFixtureData } from '../maintenance/known-fixture-cleanup.mjs';

const PREFIX=`${API_PREFIX}/admin`;
const HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const MAX_BODY_BYTES=32_000;
const SETTINGS_LIMITS=Object.freeze({companyName:160,document:64,phone:64,address:500});
const INVENTORY_TABLES=Object.freeze([
  ['customers','created_at'],['vehicles','created_at'],['rentals','created_at'],['rental_payments','created_at'],
  ['expenses','created_at'],['inspections','created_at'],['inspection_items','created_at'],['maintenance','created_at'],
  ['ledger','created_at'],['contract_templates','created_at'],['issued_contracts','created_at'],['billing_plans','created_at'],
  ['billing_installments','created_at'],['billing_payments','created_at'],['billing_payment_conflicts','created_at'],
  ['collection_actions','created_at'],['attachments','created_at'],['audit_log','created_at'],['sync_changes','created_at']
]);

function json(body,status=200,headers={}){return new Response(JSON.stringify(body),{status,headers:{...HEADERS,...headers}});}
function adminAuth(auth){return Boolean(auth?.installationId&&auth?.userId&&canCloud(auth,'*'));}
function numberParam(value,{fallback=0,min=0,max=1000}={}){const n=Number(value);return Number.isInteger(n)&&n>=min?Math.min(n,max):fallback;}
function parseJson(value,fallback={}){try{return value?JSON.parse(String(value)):structuredClone(fallback);}catch{return structuredClone(fallback);}}
function cleanText(value,max){return String(value??'').trim().slice(0,max);}
async function readJson(request){if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')??''))throw Object.assign(new Error('content_type'),{status:415});const text=await request.text();if(new TextEncoder().encode(text).byteLength>MAX_BODY_BYTES)throw Object.assign(new Error('payload_too_large'),{status:413});try{return JSON.parse(text||'{}');}catch{throw Object.assign(new Error('invalid_json'),{status:400});}}
function cleanSettings(input,current={}){const next={...current};for(const [key,max] of Object.entries(SETTINGS_LIMITS))if(Object.hasOwn(input??{},key))next[key]=cleanText(input[key],max);return next;}
async function getSettings(db,installationId){const row=await db.prepare('SELECT settings_json AS settingsJson,version,updated_at AS updatedAt FROM app_settings WHERE installation_id=? LIMIT 1').bind(installationId).first();return row?{settings:parseJson(row.settingsJson,{}),version:Number(row.version)||0,updatedAt:row.updatedAt}:{settings:{},version:0,updatedAt:null};}
async function listAudit(request,db,auth){
  const url=new URL(request.url),where=['a.installation_id=?','a.deleted_at IS NULL'],params=[auth.installationId],exact=[['action','a.action'],['entityType','a.entity_type'],['actorId','a.actor_id']];
  for(const [query,column] of exact){const value=url.searchParams.get(query);if(value){where.push(`${column}=?`);params.push(value.slice(0,160));}}
  const from=url.searchParams.get('from'),to=url.searchParams.get('to');if(from){where.push('a.at>=?');params.push(from.slice(0,64));}if(to){where.push('a.at<=?');params.push(to.slice(0,64));}
  const limit=numberParam(url.searchParams.get('limit'),{fallback:25,min:1,max:100}),offset=numberParam(url.searchParams.get('offset'),{fallback:0,min:0,max:100000}),clause=where.join(' AND ');
  const rows=await db.prepare(`SELECT a.id,a.actor_id AS actorId,u.name AS actorName,a.action,a.entity_type AS entityType,a.entity_id AS entityId,a.details_json AS detailsJson,a.at,a.created_at AS createdAt FROM audit_log a LEFT JOIN users u ON u.installation_id=a.installation_id AND u.id=a.actor_id WHERE ${clause} ORDER BY a.at DESC,a.id DESC LIMIT ? OFFSET ?`).bind(...params,limit,offset).all();
  const totalRow=await db.prepare(`SELECT COUNT(*) AS total FROM audit_log a WHERE ${clause}`).bind(...params).first(),total=Number(totalRow?.total)||0,items=(rows?.results??[]).map(row=>({...row,details:parseJson(row.detailsJson,{}),detailsJson:undefined}));
  return json({ok:true,items,pagination:{total,limit,offset,nextOffset:offset+items.length<total?offset+items.length:null}});
}
async function r2Inventory(r2,installationId){
  if(!r2?.list)return{available:false,objects:0,bytes:0,attachments:{objects:0,bytes:0},backups:{objects:0,bytes:0}};
  const result={available:true,objects:0,bytes:0,attachments:{objects:0,bytes:0},backups:{objects:0,bytes:0}};
  for(const [kind,prefix] of [['attachments',`installations/${installationId}/`],['backups',`backups/${installationId}/`]]){
    let cursor;
    do{
      const page=await r2.list({prefix,limit:1000,cursor}),objects=page?.objects??[];
      for(const object of objects){result[kind].objects++;result[kind].bytes+=Number(object.size)||0;result.objects++;result.bytes+=Number(object.size)||0;}
      cursor=page?.truncated?page.cursor:null;
    }while(cursor);
  }
  return result;
}
async function dataInventory(env,auth){
  const tables=[];
  for(const [table,dateColumn] of INVENTORY_TABLES){
    const row=await env.DB.prepare(`SELECT COUNT(*) AS total,MIN(${dateColumn}) AS firstAt,MAX(${dateColumn}) AS lastAt FROM ${table} WHERE installation_id=?${table==='sync_changes'?'':' AND deleted_at IS NULL'}`).bind(auth.installationId).first();
    tables.push({table,total:Number(row?.total)||0,firstAt:row?.firstAt??null,lastAt:row?.lastAt??null});
  }
  const migrationRows=await env.DB.prepare(`SELECT id,actor_id AS actorId,details_json AS detailsJson,at FROM audit_log
    WHERE installation_id=? AND action='migration.cloud.seed' AND deleted_at IS NULL ORDER BY at DESC LIMIT 25`).bind(auth.installationId).all();
  const actorRows=await env.DB.prepare(`SELECT COALESCE(actor_id,'SYSTEM') AS actorId,COUNT(*) AS total,MIN(at) AS firstAt,MAX(at) AS lastAt
    FROM audit_log WHERE installation_id=? AND deleted_at IS NULL GROUP BY COALESCE(actor_id,'SYSTEM') ORDER BY total DESC LIMIT 20`).bind(auth.installationId).all();
  const markerRows=await env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM customers WHERE installation_id=? AND deleted_at IS NULL AND (lower(name) LIKE '%qa%' OR lower(name) LIKE '%teste%' OR lower(name) LIKE '%demo%')) AS customers,
    (SELECT COUNT(*) FROM vehicles WHERE installation_id=? AND deleted_at IS NULL AND (lower(model) LIKE '%qa%' OR lower(model) LIKE '%teste%' OR lower(plate) LIKE '%qa%')) AS vehicles,
    (SELECT COUNT(*) FROM rentals WHERE installation_id=? AND deleted_at IS NULL AND (lower(COALESCE(notes,'')) LIKE '%qa%' OR lower(COALESCE(notes,'')) LIKE '%teste%' OR lower(COALESCE(notes,'')) LIKE '%demo%')) AS rentals`)
    .bind(auth.installationId,auth.installationId,auth.installationId).first();
  const demoAudit=await env.DB.prepare(`SELECT COUNT(*) AS total,MIN(at) AS firstAt,MAX(at) AS lastAt FROM audit_log
    WHERE installation_id=? AND deleted_at IS NULL AND actor_id IN ('USR-VICTOR-DEMO','USR-VICTOR-DEMO-ISOLATED')`).bind(auth.installationId).first();
  const r2=await r2Inventory(env.ATTACHMENTS,auth.installationId);
  return{ok:true,installationId:auth.installationId,tables,migrations:(migrationRows?.results??[]).map(row=>({...row,details:parseJson(row.detailsJson,{}),detailsJson:undefined})),actors:actorRows?.results??[],markers:{customers:Number(markerRows?.customers)||0,vehicles:Number(markerRows?.vehicles)||0,rentals:Number(markerRows?.rentals)||0},demoAudit:{total:Number(demoAudit?.total)||0,firstAt:demoAudit?.firstAt??null,lastAt:demoAudit?.lastAt??null},r2};
}
async function cleanupFixtures(request,env,auth){
  if(auth.installationId!=='LOCADORA-GEORGE')return json({ok:false,error:'cleanup_wrong_tenant'},409);
  const input=await readJson(request);
  if(String(input.confirmation??'')!=='EXCLUIR DADOS DE TESTE')return json({ok:false,error:'cleanup_confirmation_required'},400);
  const result=await cleanupKnownFixtureData(env,{actorId:auth.userId});
  return json(result,200);
}
async function updateSettings(request,db,auth){
  const input=await readJson(request),expectedVersion=Number(input.expectedVersion);if(!Number.isInteger(expectedVersion)||expectedVersion<0)return json({ok:false,error:'expected_version_required'},400);
  const current=await getSettings(db,auth.installationId);if(current.version!==expectedVersion)return json({ok:false,error:'version_conflict',current},409);
  const settings=cleanSettings(input.data,current.settings),encoded=JSON.stringify(settings);if(new TextEncoder().encode(encoded).byteLength>MAX_BODY_BYTES)return json({ok:false,error:'payload_too_large'},413);
  const now=new Date().toISOString(),nextVersion=expectedVersion+1,auditId=`AUD-${crypto.randomUUID()}`,operationId=`admin:settings:${auth.installationId}:v${nextVersion}:${crypto.randomUUID()}`,details=JSON.stringify({changed:Object.keys(SETTINGS_LIMITS).filter(key=>Object.hasOwn(input.data??{},key))});
  let write;
  if(expectedVersion===0)write=db.prepare('INSERT INTO app_settings (installation_id,settings_json,updated_at,version,updated_by_device) SELECT ?,?,?,1,? WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE installation_id=?)').bind(auth.installationId,encoded,now,auth.deviceId??null,auth.installationId);
  else write=db.prepare('UPDATE app_settings SET settings_json=?,updated_at=?,version=version+1,updated_by_device=? WHERE installation_id=? AND version=?').bind(encoded,now,auth.deviceId??null,auth.installationId,expectedVersion);
  const guard='EXISTS (SELECT 1 FROM app_settings WHERE installation_id=? AND version=? AND updated_at=?)',guardParams=[auth.installationId,nextVersion,now];
  const audit=db.prepare(`INSERT INTO audit_log (id,installation_id,actor_id,action,entity_type,entity_id,details_json,at,created_at,updated_at,version,updated_by_device,deleted_at) SELECT ?,?,?,?,?,?,?,?,?,?,1,?,NULL WHERE ${guard}`).bind(auditId,auth.installationId,auth.userId,'settings.update','app_settings',auth.installationId,details,now,now,now,auth.deviceId??null,...guardParams);
  const delta=appendChangeStatement(db,{operationId,installationId:auth.installationId,deviceId:auth.deviceId??null,entityType:'appSettings',entityId:auth.installationId,operation:'update',baseVersion:expectedVersion,entityVersion:nextVersion,payload:{id:auth.installationId,settingsJson:encoded,updatedAt:now,version:nextVersion,updatedByDevice:auth.deviceId??null},createdAt:now,guardSql:guard,guardParams});
  const results=await db.batch([write,audit,delta]);if(Number(results?.[0]?.meta?.changes??0)!==1)return json({ok:false,error:'version_conflict',current:await getSettings(db,auth.installationId)},409);
  return json({ok:true,settings,version:nextVersion,updatedAt:now});
}

export function isAdminRoute(request){const p=new URL(request.url).pathname;return p===PREFIX||p.startsWith(`${PREFIX}/`);}
export async function handleAdminRoute(request,env,_ctx,{auth=null}={}){
  if(!auth?.installationId||!auth?.userId)return json({ok:false,error:'unauthorized'},401);if(!adminAuth(auth))return json({ok:false,error:'forbidden'},403);if(!env?.DB?.prepare)return json({ok:false,error:'database_unavailable'},503);
  const p=new URL(request.url).pathname,m=request.method.toUpperCase();
  try{if(p===`${PREFIX}/audit`&&m==='GET')return listAudit(request,env.DB,auth);if(p===`${PREFIX}/data-inventory`&&m==='GET')return json(await dataInventory(env,auth));if(p===`${PREFIX}/cleanup-known-fixtures`&&m==='POST')return cleanupFixtures(request,env,auth);if(p===`${PREFIX}/settings`&&m==='GET'){const current=await getSettings(env.DB,auth.installationId);return json({ok:true,...current});}if(p===`${PREFIX}/settings`&&m==='PATCH')return updateSettings(request,env.DB,auth);if(p===`${PREFIX}/audit`||p===`${PREFIX}/data-inventory`)return json({ok:false,error:'method_not_allowed'},405,{allow:'GET'});if(p===`${PREFIX}/cleanup-known-fixtures`)return json({ok:false,error:'method_not_allowed'},405,{allow:'POST'});if(p===`${PREFIX}/settings`)return json({ok:false,error:'method_not_allowed'},405,{allow:'GET, PATCH'});return json({ok:false,error:'not_found'},404);}catch(error){if(error?.status)return json({ok:false,error:error.message},error.status);console.error('admin route error',error);return json({ok:false,error:error?.message||'internal_error'},500);}
}
