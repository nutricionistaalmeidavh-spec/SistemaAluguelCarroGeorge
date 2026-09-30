import { API_PREFIX } from '../config.mjs';
import { canCloud } from '../auth/permissions.mjs';
import { verifyPassword } from '../auth/password.mjs';
import { clearSessionCookie } from '../auth/session.mjs';
import { writeCloudBackup } from '../backup/r2-backup.mjs';
import { restoreCloudBackup } from '../backup/restore.mjs';

const PREFIX=`${API_PREFIX}/backups`,HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const MAX_BODY_BYTES=32_000;
function json(body,status=200,headers={}){return new Response(JSON.stringify(body),{status,headers:{...HEADERS,...headers}});}
async function readJson(request){
  const type=request.headers.get('content-type')??'';if(!/^application\/json(?:;|$)/i.test(type))return{};
  const text=await request.text();if(new TextEncoder().encode(text).byteLength>MAX_BODY_BYTES)throw Object.assign(new Error('payload_too_large'),{status:413});
  try{return JSON.parse(text||'{}');}catch{throw Object.assign(new Error('invalid_json'),{status:400});}
}
async function verifyRestoreAuthorization(request,env,auth){
  const input=await readJson(request),password=String(input.password??'');
  if(input.confirmation!=='RESTAURAR'||!password)return{ok:false,response:json({ok:false,error:'restore_confirmation_required'},400)};
  const user=await env.DB.prepare('SELECT password_hash AS passwordHash FROM users WHERE installation_id=? AND id=? AND active=1 AND deleted_at IS NULL LIMIT 1').bind(auth.installationId,auth.userId).first();
  if(!user?.passwordHash)return{ok:false,response:json({ok:false,error:'invalid_credentials'},403)};
  const verified=await verifyPassword(password,user.passwordHash);if(!verified.ok)return{ok:false,response:json({ok:false,error:'invalid_credentials'},403)};
  return{ok:true};
}
export function isBackupRoute(request){const p=new URL(request.url).pathname;return p===PREFIX||p.startsWith(`${PREFIX}/`);}
export async function handleBackupRoute(request,env,_ctx,{auth=null}={}){
  if(!auth)return json({ok:false,error:'unauthorized'},401);
  if(!canCloud(auth,'*')&&!canCloud(auth,'backup.create'))return json({ok:false,error:'forbidden'},403);
  const p=new URL(request.url).pathname,m=request.method.toUpperCase();
  try{
    if(p===PREFIX&&m==='POST')return json({ok:true,backup:await writeCloudBackup(env,auth.installationId)},201);
    if(p===PREFIX&&m==='GET'){
      if(!canCloud(auth,'*'))return json({ok:false,error:'forbidden'},403);
      const rows=await env.DB.prepare('SELECT id,restore_generation AS restoreGeneration,status,created_at AS createdAt,completed_at AS completedAt,error_code AS errorCode FROM cloud_backups WHERE installation_id=? ORDER BY created_at DESC LIMIT 50').bind(auth.installationId).all();
      return json({ok:true,backups:rows?.results??[]});
    }
    const restore=p.match(new RegExp(`^${PREFIX}/([^/]+)/restore/?$`));
    if(restore&&m==='POST'){
      if(!canCloud(auth,'*'))return json({ok:false,error:'forbidden'},403);
      const gate=await verifyRestoreAuthorization(request,env,auth);if(!gate.ok)return gate.response;
      const result=await restoreCloudBackup(env,auth,decodeURIComponent(restore[1]));
      return json({ok:true,...result,reauthRequired:true},200,{'set-cookie':clearSessionCookie()});
    }
    return json({ok:false,error:'not_found'},404);
  }catch(error){console.error('backup route error',error);return json({ok:false,error:error?.message||'internal_error'},Number(error?.status)||500);}
}
