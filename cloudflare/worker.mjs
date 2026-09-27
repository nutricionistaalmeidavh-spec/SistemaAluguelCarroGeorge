import { API_PREFIX, publicHealth } from './config.mjs';

const JSON_HEADERS=Object.freeze({
  'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store',
  'x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer'
});

function json(body,status=200,headers={}){
  return new Response(JSON.stringify(body),{status,headers:{...JSON_HEADERS,...headers}});
}

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname===`${API_PREFIX}/health`){
      if(request.method!=='GET'&&request.method!=='HEAD')return json({ok:false,error:'method_not_allowed'},405,{allow:'GET, HEAD'});
      const body=publicHealth();
      return request.method==='HEAD'?new Response(null,{status:200,headers:JSON_HEADERS}):json(body);
    }
    if(url.pathname.startsWith(`${API_PREFIX}/`))return json({ok:false,error:'not_found'},404);
    if(env?.ASSETS?.fetch)return env.ASSETS.fetch(request);
    return json({ok:false,error:'assets_unavailable'},503);
  }
};
