import { API_PREFIX, publicHealth } from './config.mjs';
import { handleAttachmentRoute, isAttachmentRoute } from './api/attachment-routes.mjs';
import { handleAuthRoute } from './api/auth-routes.mjs';
import { handleBillingRoute, isBillingOperationRoute } from './api/billing-routes.mjs';
import { handleRentalRoute, isRentalOperationRoute } from './api/rental-routes.mjs';
import { handleSyncRoute, isSyncRoute } from './api/sync-routes.mjs';
import { resolveSession } from './auth/session.mjs';
import { routeApi } from './api/router.mjs';

const JSON_HEADERS=Object.freeze({
  'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store',
  'x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer'
});

function json(body,status=200,headers={}){return new Response(JSON.stringify(body),{status,headers:{...JSON_HEADERS,...headers}});}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname===`${API_PREFIX}/health`){
      if(request.method!=='GET'&&request.method!=='HEAD')return json({ok:false,error:'method_not_allowed'},405,{allow:'GET, HEAD'});
      const body=publicHealth();return request.method==='HEAD'?new Response(null,{status:200,headers:JSON_HEADERS}):json(body);
    }
    if(url.pathname.startsWith(`${API_PREFIX}/auth/`)){
      const auth=url.pathname===`${API_PREFIX}/auth/login`?null:await resolveSession(request,env);
      return handleAuthRoute(request,env,ctx,{auth});
    }
    if(url.pathname.startsWith(`${API_PREFIX}/`)){
      const auth=await resolveSession(request,env);
      if(isSyncRoute(request))return handleSyncRoute(request,env,ctx,{auth});
      if(isAttachmentRoute(request))return handleAttachmentRoute(request,env,ctx,{auth});
      if(isRentalOperationRoute(request))return handleRentalRoute(request,env,ctx,{auth});
      if(isBillingOperationRoute(request))return handleBillingRoute(request,env,ctx,{auth});
      return routeApi(request,env,ctx,{auth});
    }
    if(env?.ASSETS?.fetch)return env.ASSETS.fetch(request);
    return json({ok:false,error:'assets_unavailable'},503);
  }
};
