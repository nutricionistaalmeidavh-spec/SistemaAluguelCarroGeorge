import { API_PREFIX } from '../config.mjs';
import { attachmentLimits, deleteAttachment, getAttachment, putAttachment } from '../storage/r2-attachments.mjs';

const JSON_HEADERS=Object.freeze({'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
const ATTACHMENT_ROUTE=new RegExp(`^${API_PREFIX}/attachments/([^/]+)/?$`);

function json(body,status=200,headers={}){return new Response(JSON.stringify(body),{status,headers:{...JSON_HEADERS,...headers}});}
function statusFor(error){
  const code=error?.code??'';
  if(code==='unauthorized')return 401;
  if(code==='forbidden')return 403;
  if(code==='attachment_not_found'||code==='attachment_object_missing')return 404;
  if(code==='attachment_id_conflict')return 409;
  if(code==='database_unavailable'||code==='r2_unavailable')return 503;
  if(code==='attachment_too_large')return 413;
  if(code==='attachment_mime_not_allowed')return 415;
  if(code.endsWith('_invalid')||code==='attachment_size_mismatch'||code==='attachment_body_invalid')return 400;
  return 500;
}
export function isAttachmentRoute(request){return ATTACHMENT_ROUTE.test(new URL(request.url).pathname)&&['PUT','GET','DELETE'].includes(request.method.toUpperCase());}

export async function handleAttachmentRoute(request,env,_ctx,{auth=null}={}){
  const match=new URL(request.url).pathname.match(ATTACHMENT_ROUTE),method=request.method.toUpperCase();
  if(!match||!['PUT','GET','DELETE'].includes(method))return json({ok:false,error:'not_found'},404);
  if(!auth?.installationId||!auth?.userId||auth.active===false||auth.active===0)return json({ok:false,error:'unauthorized'},401);
  const id=decodeURIComponent(match[1]);
  try{
    if(method==='PUT'){
      const url=new URL(request.url),entityType=url.searchParams.get('entityType'),entityId=url.searchParams.get('entityId');
      const mimeType=String(request.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();
      const declared=request.headers.get('content-length');
      if(declared&&Number(declared)>attachmentLimits.maxBytes)return json({ok:false,error:'attachment_too_large'},413);
      const data=await request.arrayBuffer();
      const item=await putAttachment(env,auth,{id,entityType,entityId,mimeType,originalName:request.headers.get('x-file-name')??'',sizeBytes:data.byteLength},data);
      return json({ok:true,item},201);
    }
    if(method==='GET'){
      const {metadata,object}=await getAttachment(env,auth,id);
      const headers=new Headers({'content-type':metadata.mimeType,'content-length':String(metadata.sizeBytes),'cache-control':'private, no-store','x-content-type-options':'nosniff','x-content-sha256':metadata.sha256,'content-disposition':'inline'});
      if(object.httpEtag)headers.set('etag',object.httpEtag);
      return new Response(object.body,{status:200,headers});
    }
    const result=await deleteAttachment(env,auth,id);return json(result,200);
  }catch(error){
    const status=statusFor(error);if(status===500)console.error('attachment route error',error);
    return json({ok:false,error:error?.code??error?.message??'internal_error'},status);
  }
}
