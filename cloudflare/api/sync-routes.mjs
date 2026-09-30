import { API_PREFIX } from '../config.mjs';
import { canCloud } from '../auth/permissions.mjs';
import { getResourceDefinition } from './resource-map.mjs';
import { createD1Repository } from '../db/d1-repository.mjs';
import { appendChangeStatement, findChangeByOperationId, listChangesAfter } from '../sync/change-log.mjs';

const JSON_HEADERS=Object.freeze({'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
const MAX_JSON_BYTES=1_000_000,MAX_OPERATIONS=50,MAX_CHANGE_LIMIT=200;
const OPERATIONS_PATH=new RegExp(`^${API_PREFIX}/sync/operations/?$`),CHANGES_PATH=new RegExp(`^${API_PREFIX}/sync/changes/?$`);
const ENTITY_RESOURCE=Object.freeze({customer:'customers',vehicle:'vehicles'});
const CHANGE_READ_PERMISSION=Object.freeze({customer:'customer.read',vehicle:'vehicle.read',rental:'rental.read',rentalPayment:'finance.read',billingPayment:'billing.read',attachment:'documents.read',inspection:'inspection.read',maintenance:'maintenance.read',appSettings:'rental.read'});
const SETTINGS_LIMITS=Object.freeze({companyName:160,document:64,phone:64,address:500});

function json(body,status=200,headers={}){return new Response(JSON.stringify(body),{status,headers:{...JSON_HEADERS,...headers}});}
function session(value){return value?.installationId&&value?.userId?value:null;}
function fail(code,status=400,details=null){const error=new Error(code);error.code=code;error.status=status;error.details=details;throw error;}
function validId(value){const text=String(value??'').trim();if(!/^[A-Za-z0-9._:-]{1,160}$/.test(text))fail('invalid_id');return text;}
function scalarVersion(value){const parsed=Number(value);return Number.isInteger(parsed)&&parsed>=1?parsed:null;}
function stamp(){return new Date().toISOString();}
function generatedId(resource){const prefix=resource==='customers'?'CUS':resource==='vehicles'?'VEI':'ENT';return `${prefix}-${crypto.randomUUID()}`;}
function writableEntries(def,payload={}){const entries=[];for(const [publicName,column] of Object.entries(def.writable))if(Object.hasOwn(payload,publicName))entries.push([publicName,column,payload[publicName]]);return entries;}
function sqlValue(value){return typeof value==='object'&&value!==null?JSON.stringify(value):value;}
function singularFor(resource){return resource==='customers'?'customer':resource==='vehicles'?'vehicle':resource.replace(/s$/,'');}
function operationParts(kind){const match=String(kind??'').match(/^([A-Za-z][A-Za-z0-9]*?)\.(create|update|delete)$/);if(!match)fail('unsupported_operation');const entityType=match[1],resource=ENTITY_RESOURCE[entityType];if(!resource)fail('unsupported_operation');return{entityType,resource,action:match[2]};}
async function readJson(request){
  if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')??''))fail('content_type',415);
  const declared=Number(request.headers.get('content-length')||0);if(declared>MAX_JSON_BYTES)fail('payload_too_large',413);
  const text=await request.text();if(new TextEncoder().encode(text).byteLength>MAX_JSON_BYTES)fail('payload_too_large',413);
  try{return JSON.parse(text||'{}');}catch{fail('invalid_json');}
}
function conflict(current,operationId){fail('version_conflict',409,{current,operationId});}
function publicCreateItem(resource,id,input,now,deviceId){const item={id,...input,createdAt:now,updatedAt:now,version:1,updatedByDevice:deviceId??null};if(resource==='customers'&&!Object.hasOwn(item,'active'))item.active=1;return item;}
function authorizedChange(actor,change){const permission=CHANGE_READ_PERMISSION[change.entityType];return permission?canCloud(actor,permission):canCloud(actor,'*');}
function parseSettings(value){try{return value?JSON.parse(String(value)):{};}catch{return{};}}
function cleanSettings(input,current={}){const next={...current},changed=[];for(const [key,max] of Object.entries(SETTINGS_LIMITS))if(Object.hasOwn(input??{},key)){next[key]=String(input[key]??'').trim().slice(0,max);changed.push(key);}return{next,changed};}

async function applySettingsOperation(db,actor,rawOperation,operationId){
  if(!canCloud(actor,'*'))fail('forbidden',403);
  const payload=rawOperation?.payload&&typeof rawOperation.payload==='object'?rawOperation.payload:{},data=payload.data&&typeof payload.data==='object'&&!Array.isArray(payload.data)?payload.data:null;
  const baseVersion=scalarVersion(payload.expectedVersion??rawOperation?.baseVersion);if(baseVersion==null)fail('base_version_required');if(!data)fail('invalid_request');
  const current=await db.prepare('SELECT settings_json AS settingsJson,version,updated_at AS updatedAt,updated_by_device AS updatedByDevice FROM app_settings WHERE installation_id=? LIMIT 1').bind(actor.installationId).first();
  if(!current)fail('not_found',404);const currentItem={id:actor.installationId,settings:parseSettings(current.settingsJson),version:Number(current.version),updatedAt:current.updatedAt,updatedByDevice:current.updatedByDevice};if(Number(current.version)!==baseVersion)conflict(currentItem,operationId);
  const {next,changed}=cleanSettings(data,currentItem.settings);if(!changed.length)fail('invalid_request');
  const now=stamp(),entityVersion=baseVersion+1,deviceId=actor.deviceId??null,changePayload={id:actor.installationId,settingsJson:JSON.stringify(next),updatedAt:now,version:entityVersion,updatedByDevice:deviceId},item={id:actor.installationId,settings:next,version:entityVersion,updatedAt:now,updatedByDevice:deviceId};
  const guardSql='EXISTS (SELECT 1 FROM app_settings WHERE installation_id=? AND version=? AND updated_at=?)',guardParams=[actor.installationId,entityVersion,now];
  const update=db.prepare('UPDATE app_settings SET settings_json=?,updated_at=?,version=version+1,updated_by_device=? WHERE installation_id=? AND version=?').bind(changePayload.settingsJson,now,deviceId,actor.installationId,baseVersion);
  const auditId=`AUD-${crypto.randomUUID()}`,audit=db.prepare(`INSERT INTO audit_log (id,installation_id,actor_id,action,entity_type,entity_id,details_json,at,created_at,updated_at,version,updated_by_device,deleted_at) SELECT ?,?,?,?,?,?,?,?,?,?,1,?,NULL WHERE ${guardSql}`).bind(auditId,actor.installationId,actor.userId,'settings.update','app_settings',actor.installationId,JSON.stringify({changed}),now,now,now,deviceId,...guardParams);
  const change=appendChangeStatement(db,{operationId,installationId:actor.installationId,deviceId,entityType:'appSettings',entityId:actor.installationId,operation:'update',baseVersion,entityVersion,payload:changePayload,createdAt:now,guardSql,guardParams});
  const result=await db.batch([update,audit,change]);if(Number(result?.[0]?.meta?.changes??0)!==1||Number(result?.[2]?.meta?.changes??0)!==1){const latest=await db.prepare('SELECT settings_json AS settingsJson,version,updated_at AS updatedAt,updated_by_device AS updatedByDevice FROM app_settings WHERE installation_id=? LIMIT 1').bind(actor.installationId).first();conflict(latest?{id:actor.installationId,settings:parseSettings(latest.settingsJson),version:Number(latest.version),updatedAt:latest.updatedAt,updatedByDevice:latest.updatedByDevice}:null,operationId);}
  const applied=await findChangeByOperationId(db,actor.installationId,operationId);return{status:'applied',operationId,item,change:applied};
}

async function applyOperation(db,actor,rawOperation){
  const operationId=validId(rawOperation?.operationId),previous=await findChangeByOperationId(db,actor.installationId,operationId);
  if(previous)return{status:'replayed',operationId,item:previous.payload?.deleted?null:previous.payload,change:previous};
  if(!canCloud(actor,'sync.write'))fail('forbidden',403);
  if(rawOperation?.kind==='settings.update')return applySettingsOperation(db,actor,rawOperation,operationId);
  const {entityType,resource,action}=operationParts(rawOperation?.kind),def=getResourceDefinition(resource);
  if(!def||!def.writePermission||!canCloud(actor,def.writePermission))fail('forbidden',403);
  if(!db?.batch)fail('database_unavailable',503);
  const repo=createD1Repository(db,actor.installationId),payload=rawOperation?.payload&&typeof rawOperation.payload==='object'?rawOperation.payload:{},now=stamp(),deviceId=actor.deviceId??null;
  let id=payload.id?validId(payload.id):generatedId(resource),baseVersion=scalarVersion(rawOperation?.baseVersion),item=null,entityStatement=null,changePayload=null,entityVersion=null,guardSql=null,guardParams=[];

  if(action==='create'){
    const entries=writableEntries(def,payload);
    for(const field of def.required)if(!Object.hasOwn(payload,field)||payload[field]==null||String(payload[field]).trim()==='')fail('invalid_request',400,{field});
    if(!entries.length)fail('invalid_request');
    const columns=['id','installation_id',...entries.map(([,column])=>column),'created_at','updated_at','version','updated_by_device'];
    const values=[id,actor.installationId,...entries.map(([, ,value])=>sqlValue(value)),now,now,1,deviceId];
    entityStatement=db.prepare(`INSERT INTO ${def.table} (${columns.join(', ')}) VALUES (${columns.map(()=>'?').join(', ')})`).bind(...values);
    changePayload=publicCreateItem(resource,id,payload,now,deviceId);entityVersion=1;baseVersion=null;
    guardSql=`EXISTS (SELECT 1 FROM ${def.table} WHERE installation_id = ? AND id = ? AND version = 1 AND updated_at = ? AND deleted_at IS NULL)`;guardParams=[actor.installationId,id,now];
  }else{
    id=validId(payload.id);const current=await repo.get(resource,id);if(!current)fail('not_found',404);
    if(baseVersion==null)fail('base_version_required');if(Number(current.version)!==baseVersion)conflict(current,operationId);
    entityVersion=baseVersion+1;
    if(action==='update'){
      const data=payload.data&&typeof payload.data==='object'?payload.data:Object.fromEntries(Object.entries(payload).filter(([key])=>key!=='id'));
      const entries=writableEntries(def,data);if(!entries.length)fail('invalid_request');
      const assignments=entries.map(([,column])=>`${column} = ?`);assignments.push('updated_at = ?','version = version + 1','updated_by_device = ?');
      const params=[...entries.map(([, ,value])=>sqlValue(value)),now,deviceId,actor.installationId,id,baseVersion];
      entityStatement=db.prepare(`UPDATE ${def.table} SET ${assignments.join(', ')} WHERE installation_id = ? AND id = ? AND version = ? AND deleted_at IS NULL`).bind(...params);
      changePayload={...current,...data,version:entityVersion,updatedAt:now,updatedByDevice:deviceId};
      guardSql=`EXISTS (SELECT 1 FROM ${def.table} WHERE installation_id = ? AND id = ? AND version = ? AND updated_at = ? AND deleted_at IS NULL)`;guardParams=[actor.installationId,id,entityVersion,now];
    }else{
      entityStatement=db.prepare(`UPDATE ${def.table} SET deleted_at = ?, updated_at = ?, version = version + 1, updated_by_device = ? WHERE installation_id = ? AND id = ? AND version = ? AND deleted_at IS NULL`).bind(now,now,deviceId,actor.installationId,id,baseVersion);
      changePayload={id,version:entityVersion,deleted:true,updatedAt:now,updatedByDevice:deviceId};
      guardSql=`EXISTS (SELECT 1 FROM ${def.table} WHERE installation_id = ? AND id = ? AND version = ? AND deleted_at = ?)`;guardParams=[actor.installationId,id,entityVersion,now];
    }
  }

  const changeStatement=appendChangeStatement(db,{operationId,installationId:actor.installationId,deviceId,entityType:singularFor(resource),entityId:id,operation:action,baseVersion,entityVersion,payload:changePayload,createdAt:now,guardSql,guardParams});
  try{
    const result=await db.batch([entityStatement,changeStatement]);
    if(Number(result?.[0]?.meta?.changes??0)!==1||Number(result?.[1]?.meta?.changes??0)!==1){const current=await repo.get(resource,id);conflict(current,operationId);}
  }catch(error){
    const replay=await findChangeByOperationId(db,actor.installationId,operationId);if(replay)return{status:'replayed',operationId,item:replay.payload?.deleted?null:replay.payload,change:replay};
    const current=await repo.get(resource,id).catch(()=>null);if(current&&(action==='create'||Number(current.version)!==baseVersion))conflict(current,operationId);
    throw error;
  }
  item=action==='delete'?null:await repo.get(resource,id);
  const change=await findChangeByOperationId(db,actor.installationId,operationId);
  return{status:'applied',operationId,item,change};
}

export function isSyncRoute(request){const path=new URL(request.url).pathname,method=request.method.toUpperCase();return(method==='POST'&&OPERATIONS_PATH.test(path))||(method==='GET'&&CHANGES_PATH.test(path));}

export async function handleSyncRoute(request,env,_ctx,{auth=null}={}){
  const actor=session(auth);if(!actor)return json({ok:false,error:'unauthorized'},401);
  if(!env?.DB?.prepare)return json({ok:false,error:'database_unavailable'},503);
  const url=new URL(request.url),method=request.method.toUpperCase();
  try{
    if(method==='GET'&&CHANGES_PATH.test(url.pathname)){
      if(!canCloud(actor,'sync.read'))return json({ok:false,error:'forbidden'},403);
      const afterRaw=Number(url.searchParams.get('after')??0),limitRaw=Number(url.searchParams.get('limit')??100);
      if(!Number.isInteger(afterRaw)||afterRaw<0)return json({ok:false,error:'invalid_cursor'},400);
      if(!Number.isInteger(limitRaw)||limitRaw<1)return json({ok:false,error:'invalid_limit'},400);
      const limit=Math.min(limitRaw,MAX_CHANGE_LIMIT),raw=await listChangesAfter(env.DB,actor.installationId,afterRaw,limit),cursor=raw.length?raw.at(-1).sequence:afterRaw;
      const changes=raw.filter(change=>authorizedChange(actor,change));
      return json({ok:true,changes,cursor,hasMore:raw.length===limit});
    }
    if(method==='POST'&&OPERATIONS_PATH.test(url.pathname)){
      const input=await readJson(request),operations=Array.isArray(input?.operations)?input.operations:[];
      if(!operations.length||operations.length>MAX_OPERATIONS)return json({ok:false,error:'invalid_operations'},400);
      const results=[];for(const operation of operations)results.push(await applyOperation(env.DB,actor,operation));
      return json({ok:true,results});
    }
    return json({ok:false,error:'not_found'},404);
  }catch(error){
    const status=Number(error?.status)||(/constraint/i.test(error?.message??'')?409:500);
    if(status===500)console.error('sync route error',error);
    return json({ok:false,error:error?.code??error?.message??'internal_error',...(error?.details??{})},status);
  }
}
