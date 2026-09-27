import { API_PREFIX } from '../config.mjs';
import { hashPassword, verifyPassword } from '../auth/password.mjs';
import { buildSessionCookie, clearSessionCookie, createSessionRecord, readSessionToken, revokeSessionToken } from '../auth/session.mjs';

const JSON_HEADERS=Object.freeze({'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
const MAX_BODY_BYTES=32_000;
function json(body,status=200,headers={}){return new Response(JSON.stringify(body),{status,headers:{...JSON_HEADERS,...headers}});}
async function body(request){
  if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')??''))throw Object.assign(new Error('content_type'),{status:415});
  const text=await request.text();if(new TextEncoder().encode(text).byteLength>MAX_BODY_BYTES)throw Object.assign(new Error('payload_too_large'),{status:413});
  try{return JSON.parse(text||'{}');}catch{throw Object.assign(new Error('invalid_json'),{status:400});}
}
export function sanitizeAuthUser(user){return{id:user.id??user.userId,username:user.username,name:user.name,role:user.role,active:Boolean(user.active)};}

export function createD1AuthService(env,request){
  const db=env?.DB;if(!db?.prepare)throw new Error('database_unavailable');
  return Object.freeze({
    async findUser(installationId,username){
      return db.prepare(`SELECT id, installation_id, username, name, role, active, password_hash FROM users
        WHERE installation_id = ? AND lower(username) = lower(?) AND active = 1 AND deleted_at IS NULL LIMIT 1`).bind(String(installationId),String(username)).first();
    },
    async upgradePassword(user,newHash){
      await db.prepare('UPDATE users SET password_hash = ?, updated_at = ?, version = version + 1 WHERE installation_id = ? AND id = ? AND deleted_at IS NULL').bind(newHash,new Date().toISOString(),user.installation_id,user.id).run();
    },
    async createSession({installationId,userId,deviceId}){
      return createSessionRecord(db,{installationId,userId,deviceId,userAgent:request.headers.get('user-agent')??''});
    },
    async revokeSession(token){return revokeSessionToken(db,token);}
  });
}

export async function handleAuthRoute(request,env,_ctx,{service=null,auth=null}={}){
  const url=new URL(request.url),base=`${API_PREFIX}/auth/`;if(!url.pathname.startsWith(base))return json({ok:false,error:'not_found'},404);
  const action=url.pathname.slice(base.length).replace(/\/$/,'');
  try{
    const authService=service??createD1AuthService(env,request);
    if(action==='login'){
      if(request.method!=='POST')return json({ok:false,error:'method_not_allowed'},405,{allow:'POST'});
      const input=await body(request),installationId=String(input.installationId??'').trim(),username=String(input.username??'').trim(),password=String(input.password??'');
      if(!installationId||!username||!password||installationId.length>120||username.length>120||password.length>512)return json({ok:false,error:'invalid_credentials'},401);
      const user=await authService.findUser(installationId,username);if(!user)return json({ok:false,error:'invalid_credentials'},401);
      const verified=await verifyPassword(password,user.password_hash);if(!verified.ok)return json({ok:false,error:'invalid_credentials'},401);
      if(verified.needsUpgrade){const upgraded=await hashPassword(password);await authService.upgradePassword(user,upgraded);}
      const session=await authService.createSession({installationId:user.installation_id,userId:user.id,deviceId:input.deviceId?String(input.deviceId):null});
      return json({ok:true,user:sanitizeAuthUser(user),expiresAt:session.expiresAt},200,{'set-cookie':buildSessionCookie(session.token)});
    }
    if(action==='me'){
      if(request.method!=='GET')return json({ok:false,error:'method_not_allowed'},405,{allow:'GET'});
      if(!auth)return json({ok:false,error:'unauthorized'},401);
      return json({ok:true,user:sanitizeAuthUser(auth)});
    }
    if(action==='logout'){
      if(request.method!=='POST')return json({ok:false,error:'method_not_allowed'},405,{allow:'POST'});
      const token=readSessionToken(request);if(token)await authService.revokeSession(token);
      return json({ok:true},200,{'set-cookie':clearSessionCookie()});
    }
    return json({ok:false,error:'not_found'},404);
  }catch(error){
    if(error?.status)return json({ok:false,error:error.message},error.status);
    if(error?.message==='database_unavailable')return json({ok:false,error:'database_unavailable'},503);
    console.error('cloud auth error',error);return json({ok:false,error:'internal_error'},500);
  }
}
