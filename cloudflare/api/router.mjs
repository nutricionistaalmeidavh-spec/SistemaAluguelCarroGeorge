import { API_PREFIX } from '../config.mjs';
import { canCloud } from '../auth/permissions.mjs';
import { getResourceDefinition } from './resource-map.mjs';
import { createD1Repository } from '../db/d1-repository.mjs';

const JSON_HEADERS=Object.freeze({
  'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store',
  'x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer'
});
const MAX_JSON_BYTES=1_000_000;

function json(body,status=200,headers={}){return new Response(JSON.stringify(body),{status,headers:{...JSON_HEADERS,...headers}});}
function clean(row){if(!row||typeof row!=='object')return row;const value={...row};delete value.installation_id;delete value.password_hash;delete value.deleted_at;return value;}
function authContext(value){return value?.installationId&&value?.userId?value:null;}
function methodAllowed(def,item,method){return (item?def.itemMethods:def.collectionMethods).includes(method);}
function allow(def,item){return (item?def.itemMethods:def.collectionMethods).join(', ');}
function generatedId(resource){const prefix=resource==='customers'?'CUS':resource==='vehicles'?'VEI':'ENT';return `${prefix}-${crypto.randomUUID()}`;}
function validId(value){return /^[A-Za-z0-9._:-]{1,120}$/.test(String(value||''));}
async function readJson(request){
  const type=request.headers.get('content-type')??'';
  if(!/^application\/json(?:;|$)/i.test(type))throw Object.assign(new Error('content_type'),{status:415});
  const declared=Number(request.headers.get('content-length')||0);if(declared>MAX_JSON_BYTES)throw Object.assign(new Error('payload_too_large'),{status:413});
  const text=await request.text();if(new TextEncoder().encode(text).byteLength>MAX_JSON_BYTES)throw Object.assign(new Error('payload_too_large'),{status:413});
  try{return JSON.parse(text||'{}');}catch{throw Object.assign(new Error('invalid_json'),{status:400});}
}

export async function routeApi(request,env,_ctx,{auth=null}={}){
  const url=new URL(request.url),match=url.pathname.match(new RegExp(`^${API_PREFIX}/([^/]+)(?:/([^/]+))?/?$`));
  if(!match)return json({ok:false,error:'not_found'},404);
  const resource=decodeURIComponent(match[1]),entityId=match[2]?decodeURIComponent(match[2]):null,def=getResourceDefinition(resource);
  if(!def)return json({ok:false,error:'not_found'},404);
  const session=authContext(auth);if(!session)return json({ok:false,error:'unauthorized'},401);
  if(!env?.DB?.prepare)return json({ok:false,error:'database_unavailable'},503);
  const method=request.method.toUpperCase();
  if(!methodAllowed(def,Boolean(entityId),method))return json({ok:false,error:'method_not_allowed'},405,{allow:allow(def,Boolean(entityId))});
  const permission=method==='GET'?def.readPermission:def.writePermission;
  if(!permission||!canCloud(session,permission))return json({ok:false,error:'forbidden'},403);
  const repo=createD1Repository(env.DB,session.installationId);
  try{
    if(method==='GET'&&!entityId){const items=await repo.list(resource);return json({ok:true,items:items.map(clean)});}
    if(method==='GET'&&entityId){const item=await repo.get(resource,entityId);return item?json({ok:true,item:clean(item)}):json({ok:false,error:'not_found'},404);}
    if(method==='POST'&&!entityId){
      const input=await readJson(request),id=validId(input.id)?String(input.id):generatedId(resource);
      const item=await repo.insert(resource,id,input,{deviceId:session.deviceId??input.deviceId??null});
      return json({ok:true,item:clean(item)},201,{location:`${API_PREFIX}/${resource}/${encodeURIComponent(id)}`});
    }
    if(method==='PATCH'&&entityId){
      const input=await readJson(request),item=await repo.update(resource,entityId,input.data??input,input.expectedVersion,{deviceId:session.deviceId??input.deviceId??null});
      return item?json({ok:true,item:clean(item)}):json({ok:false,error:'version_conflict'},409);
    }
    if(method==='DELETE'&&entityId){
      const expectedVersion=Number(request.headers.get('if-match-version')??url.searchParams.get('expectedVersion'));
      const removed=await repo.softDelete(resource,entityId,expectedVersion,{deviceId:session.deviceId??request.headers.get('x-device-id')});
      return removed?new Response(null,{status:204,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}}):json({ok:false,error:'version_conflict'},409);
    }
    return json({ok:false,error:'method_not_allowed'},405,{allow:allow(def,Boolean(entityId))});
  }catch(error){
    if(error?.status)return json({ok:false,error:error.message},error.status);
    if(/Campo obrigatório|expectedVersion|Nenhum campo|id é obrigatório/i.test(error?.message??''))return json({ok:false,error:'invalid_request',message:error.message},400);
    console.error('cloud api error',error);return json({ok:false,error:'internal_error'},500);
  }
}
