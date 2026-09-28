import { API_PREFIX } from '../config.mjs';
import { canCloud } from '../auth/permissions.mjs';
import { recordInstallmentPaymentOperation } from '../domain/payments.mjs';

const JSON_HEADERS=Object.freeze({'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
const MAX_JSON_BYTES=256_000;
const INSTALLMENT_PAYMENT=new RegExp(`^${API_PREFIX}/billing/installments/([^/]+)/payments/?$`);

function json(body,status=200,headers={}){return new Response(JSON.stringify(body),{status,headers:{...JSON_HEADERS,...headers}});}
function operationKey(request){const key=String(request.headers.get('idempotency-key')??'').trim();return key&&key.length<=160?key:null;}
async function readJson(request){
  if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')??''))throw Object.assign(new Error('content_type'),{status:415});
  const declared=Number(request.headers.get('content-length')||0);if(declared>MAX_JSON_BYTES)throw Object.assign(new Error('payload_too_large'),{status:413});
  const text=await request.text();if(new TextEncoder().encode(text).byteLength>MAX_JSON_BYTES)throw Object.assign(new Error('payload_too_large'),{status:413});
  try{return JSON.parse(text||'{}');}catch{throw Object.assign(new Error('invalid_json'),{status:400});}
}
function statusFor(error){
  if(error?.status)return error.status;
  if(error?.code==='payment_exceeds_balance'||error?.code==='installment_cancelled')return 409;
  if(error?.code==='installment_not_found')return 404;
  if(/required$|^invalid_|_invalid$/.test(error?.code??''))return 400;
  return 500;
}

export function isBillingOperationRoute(request){return request.method.toUpperCase()==='POST'&&INSTALLMENT_PAYMENT.test(new URL(request.url).pathname);}

export async function handleBillingRoute(request,env,_ctx,{auth=null}={}){
  const match=new URL(request.url).pathname.match(INSTALLMENT_PAYMENT);
  if(request.method.toUpperCase()!=='POST'||!match)return json({ok:false,error:'not_found'},404);
  if(!auth?.installationId||!auth?.userId)return json({ok:false,error:'unauthorized'},401);
  if(!canCloud(auth,'billing.write')&&!canCloud(auth,'finance.write'))return json({ok:false,error:'forbidden'},403);
  if(!env?.DB?.prepare||typeof env.DB.batch!=='function')return json({ok:false,error:'database_unavailable'},503);
  const key=operationKey(request);if(!key)return json({ok:false,error:'idempotency_key_required'},400);
  try{
    const input=await readJson(request),installmentId=decodeURIComponent(match[1]);
    const outcome=await recordInstallmentPaymentOperation({db:env.DB,auth},{...input,installmentId},key);
    return json({ok:true,item:outcome.result,replayed:Boolean(outcome.replayed)},outcome.replayed?200:201);
  }catch(error){
    const status=statusFor(error);if(status===500)console.error('billing operation error',error);
    return json({ok:false,error:error?.code??error?.message??'internal_error'},status);
  }
}
