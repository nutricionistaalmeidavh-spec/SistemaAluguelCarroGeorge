import { API_PREFIX } from '../config.mjs';
import { hashPassword, verifyPassword } from '../auth/password.mjs';
import { buildSessionCookie, clearSessionCookie, createSessionRecord, readSessionToken, revokeSessionToken } from '../auth/session.mjs';
import { ensureGeorgeAdmin, GEORGE_INSTALLATION_ID } from '../auth/george-provision.mjs';

const JSON_HEADERS=Object.freeze({'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
const MAX_BODY_BYTES=32_000;
const MIN_PASSWORD_LENGTH=10;
const MAX_PASSWORD_LENGTH=512;
function json(body,status=200,headers={}){return new Response(JSON.stringify(body),{status,headers:{...JSON_HEADERS,...headers}});}
async function body(request){
  if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')??''))throw Object.assign(new Error('content_type'),{status:415});
  const text=await request.text();if(new TextEncoder().encode(text).byteLength>MAX_BODY_BYTES)throw Object.assign(new Error('payload_too_large'),{status:413});
  try{return JSON.parse(text||'{}');}catch{throw Object.assign(new Error('invalid_json'),{status:400});}
}
function validIdentity(installationId,username,password){return Boolean(installationId&&username&&password&&installationId.length<=120&&username.length<=120&&password.length<=MAX_PASSWORD_LENGTH);}
function strongPassword(value){const password=String(value??'');return password.length>=MIN_PASSWORD_LENGTH&&password.length<=MAX_PASSWORD_LENGTH;}
export function sanitizeAuthUser(user){return{id:user.id??user.userId,username:user.username,name:user.name,role:user.role,active:Boolean(user.active)};}

export function createD1AuthService(env,request){
  const db=env?.DB;if(!db?.prepare)throw new Error('database_unavailable');
  return Object.freeze({
    async findUser(installationId,username){
      if(String(installationId)===GEORGE_INSTALLATION_ID)await ensureGeorgeAdmin(db);
      return db.prepare(`SELECT id, installation_id, username, name, role, active, password_hash, must_change_password FROM users
        WHERE installation_id = ? AND lower(username) = lower(?) AND active = 1 AND deleted_at IS NULL LIMIT 1`).bind(String(installationId),String(username)).first();
    },
    async upgradePassword(user,newHash){
      await db.prepare('UPDATE users SET password_hash = ?, updated_at = ?, version = version + 1 WHERE installation_id = ? AND id = ? AND deleted_at IS NULL').bind(newHash,new Date().toISOString(),user.installation_id,user.id).run();
    },
    async completeFirstAccess(user,newHash){
      const result=await db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ?, version = version + 1 WHERE installation_id = ? AND id = ? AND must_change_password = 1 AND deleted_at IS NULL').bind(newHash,new Date().toISOString(),user.installation_id,user.id).run();
      if(Number(result?.meta?.changes??0)!==1)throw Object.assign(new Error('first_access_conflict'),{status:409});
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
    if(action==='bootstrap'){
      if(request.method!=='POST')return json({ok:false,error:'method_not_allowed'},405,{allow:'POST'});
      await ensureGeorgeAdmin(env?.DB);
      return json({ok:true});
    }
    if(action==='login'){
      if(request.method!=='POST')return json({ok:false,error:'method_not_allowed'},405,{allow:'POST'});
      const input=await body(request),installationId=String(input.installationId??'').trim(),username=String(input.username??'').trim(),password=String(input.password??'');
      if(!validIdentity(installationId,username,password))return json({ok:false,error:'invalid_credentials'},401);
      const authService=service??createD1AuthService(env,request),user=await authService.findUser(installationId,username);if(!user)return json({ok:false,error:'invalid_credentials'},401);
      const verified=await verifyPassword(password,user.password_hash);if(!verified.ok)return json({ok:false,error:'invalid_credentials'},401);
      if(Boolean(user.must_change_password))return json({ok:false,error:'password_change_required'},403);
      if(verified.needsUpgrade){const upgraded=await hashPassword(password);await authService.upgradePassword(user,upgraded);}
      const session=await authService.createSession({installationId:user.installation_id,userId:user.id,deviceId:input.deviceId?String(input.deviceId):null});
      return json({ok:true,user:sanitizeAuthUser(user),expiresAt:session.expiresAt},200,{'set-cookie':buildSessionCookie(session.token)});
    }
    if(action==='first-access'){
      if(request.method!=='POST')return json({ok:false,error:'method_not_allowed'},405,{allow:'POST'});
      const input=await body(request),installationId=String(input.installationId??'').trim(),username=String(input.username??'').trim(),currentPassword=String(input.currentPassword??''),newPassword=String(input.newPassword??'');
      if(!strongPassword(newPassword))return json({ok:false,error:'weak_password',minimumLength:MIN_PASSWORD_LENGTH},400);
      if(!validIdentity(installationId,username,currentPassword))return json({ok:false,error:'invalid_credentials'},401);
      const authService=service??createD1AuthService(env,request),user=await authService.findUser(installationId,username);if(!user)return json({ok:false,error:'invalid_credentials'},401);
      const verified=await verifyPassword(currentPassword,user.password_hash);if(!verified.ok)return json({ok:false,error:'invalid_credentials'},401);
      if(!Boolean(user.must_change_password))return json({ok:false,error:'first_access_not_required'},409);
      const newHash=await hashPassword(newPassword);await authService.completeFirstAccess(user,newHash);
      const session=await authService.createSession({installationId:user.installation_id,userId:user.id,deviceId:input.deviceId?String(input.deviceId):null});
      return json({ok:true,user:sanitizeAuthUser({...user,must_change_password:0}),expiresAt:session.expiresAt},200,{'set-cookie':buildSessionCookie(session.token)});
    }
    const authService=service??createD1AuthService(env,request);
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
