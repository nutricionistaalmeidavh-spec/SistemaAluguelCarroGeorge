import { API_PREFIX } from '../config.mjs';
import { canCloud } from '../auth/permissions.mjs';
import { appendChangeStatement } from '../sync/change-log.mjs';

const PREFIX=`${API_PREFIX}/admin`;
const HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const MAX_BODY_BYTES=32_000;
const SETTINGS_LIMITS=Object.freeze({companyName:160,document:64,phone:64,address:500});

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
  try{if(p===`${PREFIX}/audit`&&m==='GET')return listAudit(request,env.DB,auth);if(p===`${PREFIX}/settings`&&m==='GET'){const current=await getSettings(env.DB,auth.installationId);return json({ok:true,...current});}if(p===`${PREFIX}/settings`&&m==='PATCH')return updateSettings(request,env.DB,auth);if(p===`${PREFIX}/audit`)return json({ok:false,error:'method_not_allowed'},405,{allow:'GET'});if(p===`${PREFIX}/settings`)return json({ok:false,error:'method_not_allowed'},405,{allow:'GET, PATCH'});return json({ok:false,error:'not_found'},404);}catch(error){if(error?.status)return json({ok:false,error:error.message},error.status);console.error('admin route error',error);return json({ok:false,error:error?.message||'internal_error'},500);}
}
