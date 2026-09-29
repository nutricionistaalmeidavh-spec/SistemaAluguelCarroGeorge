import { API_PREFIX, publicHealth } from './config.mjs';
import { handleAttachmentRoute,isAttachmentRoute } from './api/attachment-routes.mjs';
import { handleAuthRoute } from './api/auth-routes.mjs';
import { handleBillingRoute,isBillingOperationRoute } from './api/billing-routes.mjs';
import { handleInspectionRoute,isInspectionOperationRoute } from './api/inspection-routes.mjs';
import { handleRentalRoute,isRentalOperationRoute } from './api/rental-routes.mjs';
import { handleSyncRoute,isSyncRoute } from './api/sync-routes.mjs';
import { handleDeviceManagementRoute,isDeviceManagementRoute } from './api/device-routes.mjs';
import { handleBackupRoute,isBackupRoute } from './api/backup-routes.mjs';
import { handleReplicaRoute,isReplicaRoute } from './api/replica-routes.mjs';
import { handleMigrationRoute,isMigrationRoute } from './api/migration-routes.mjs';
import { resolveSession } from './auth/session.mjs';
import { resolveDeviceCredential } from './auth/device-credentials.mjs';
import { throttleIdentity,checkLoginThrottle,recordLoginFailure,clearLoginThrottle } from './auth/login-throttle.mjs';
import { checkSyncGeneration,decorateSyncResponse } from './sync/generation.mjs';
import { allowedOrigins,secureResponse,validateRequestOrigin } from './security/hardening.mjs';
import { writeCloudBackup } from './backup/r2-backup.mjs';
import { routeApi } from './api/router.mjs';

const JSON_HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
function json(body,status=200,headers={}){return new Response(JSON.stringify(body),{status,headers:{...JSON_HEADERS,...headers}});}
export function normalizeBindings(env={}){
  const DB=env.DB??env.Bd??env.bd??env.db;
  const ATTACHMENTS=env.ATTACHMENTS??env.r2??env.R2;
  if(DB===env.DB&&ATTACHMENTS===env.ATTACHMENTS)return env;
  return {...env,DB,ATTACHMENTS};
}
async function authFor(request,env){return await resolveSession(request,env)||await resolveDeviceCredential(request,env);}
function isMutation(method){return ['POST','PUT','PATCH','DELETE'].includes(String(method).toUpperCase());}
function requiresGeneration(pathname,method){
  if(!isMutation(method)||!pathname.startsWith(`${API_PREFIX}/`))return false;
  if(pathname.startsWith(`${API_PREFIX}/auth/`))return false;
  if(pathname.startsWith(`${API_PREFIX}/devices`))return false;
  if(pathname.startsWith(`${API_PREFIX}/sessions`))return false;
  if(pathname.startsWith(`${API_PREFIX}/backups`))return false;
  if(pathname.startsWith(`${API_PREFIX}/migration`))return false;
  return true;
}
async function generationFor(request,env,auth){
  const generation=await checkSyncGeneration(request,env.DB,auth);
  if(generation.ok)return generation;
  return {...generation,response:json({ok:false,error:generation.error,restoreGeneration:generation.serverGeneration,clientGeneration:generation.clientGeneration},409)};
}
async function withGeneration(response,generation){return generation?decorateSyncResponse(response,generation.serverGeneration):response;}

async function dispatch(request,env,ctx){
  const url=new URL(request.url);
  if(url.pathname===`${API_PREFIX}/health`){
    if(!['GET','HEAD'].includes(request.method))return json({ok:false,error:'method_not_allowed'},405,{allow:'GET, HEAD'});
    const body=publicHealth();
    return request.method==='HEAD'?new Response(null,{status:200,headers:JSON_HEADERS}):json(body);
  }
  if(url.pathname.startsWith(`${API_PREFIX}/`)&&!validateRequestOrigin(request,{allowedOrigins:allowedOrigins(env)}))return json({ok:false,error:'origin_forbidden'},403);
  if(url.pathname===`${API_PREFIX}/auth/login`){
    const identity=await throttleIdentity(request);
    if(identity){
      const gate=await checkLoginThrottle(env.DB,identity.keyHash);
      if(gate.blocked)return json({ok:false,error:'login_throttled',retryAfterSeconds:gate.retryAfterSeconds},429,{'retry-after':String(gate.retryAfterSeconds)});
    }
    const response=await handleAuthRoute(request,env,ctx,{auth:null});
    if(identity){if(response.status===200)await clearLoginThrottle(env.DB,identity.keyHash);else if(response.status===401)await recordLoginFailure(env.DB,identity.keyHash);}
    return response;
  }
  if(url.pathname.startsWith(`${API_PREFIX}/auth/`)){
    const auth=await authFor(request,env);
    return handleAuthRoute(request,env,ctx,{auth});
  }
  if(url.pathname.startsWith(`${API_PREFIX}/`)){
    const auth=await authFor(request,env);
    let generation=null;
    if(requiresGeneration(url.pathname,request.method)){
      generation=await generationFor(request,env,auth);
      if(generation.response)return generation.response;
    }
    if(isDeviceManagementRoute(request))return handleDeviceManagementRoute(request,env,ctx,{auth});
    if(isBackupRoute(request))return handleBackupRoute(request,env,ctx,{auth});
    if(isMigrationRoute(request))return handleMigrationRoute(request,env,ctx,{auth});
    if(isReplicaRoute(request))return handleReplicaRoute(request,env,ctx,{auth});
    if(isAttachmentRoute(request))return withGeneration(await handleAttachmentRoute(request,env,ctx,{auth}),generation);
    if(isRentalOperationRoute(request))return withGeneration(await handleRentalRoute(request,env,ctx,{auth}),generation);
    if(isBillingOperationRoute(request))return withGeneration(await handleBillingRoute(request,env,ctx,{auth}),generation);
    if(isInspectionOperationRoute(request))return withGeneration(await handleInspectionRoute(request,env,ctx,{auth}),generation);
    if(isSyncRoute(request)){
      const current=generation??await generationFor(request,env,auth);
      if(current.response)return current.response;
      return decorateSyncResponse(await handleSyncRoute(request,env,ctx,{auth}),current.serverGeneration);
    }
    return withGeneration(await routeApi(request,env,ctx,{auth}),generation);
  }
  if(env?.ASSETS?.fetch)return env.ASSETS.fetch(request);
  return json({ok:false,error:'assets_unavailable'},503);
}

export default{
  async fetch(request,env,ctx){
    const bindings=normalizeBindings(env);
    return secureResponse(await dispatch(request,bindings,ctx));
  },
  async scheduled(_event,env,ctx){
    const bindings=normalizeBindings(env);
    if(!bindings?.DB?.prepare||!bindings?.ATTACHMENTS?.put)return;
    const rows=await bindings.DB.prepare('SELECT id FROM installations WHERE deleted_at IS NULL ORDER BY id').all();
    for(const row of rows?.results??[])ctx.waitUntil(writeCloudBackup(bindings,row.id).catch(error=>console.error('scheduled backup failed',row.id,error?.message)));
  }
};
