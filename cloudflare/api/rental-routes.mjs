import { API_PREFIX } from '../config.mjs';
import { canCloud } from '../auth/permissions.mjs';
import { createRentalOperation } from '../domain/rentals.mjs';
import { recordRentalPaymentOperation } from '../domain/payments.mjs';

const JSON_HEADERS=Object.freeze({
  'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store',
  'x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer'
});
const MAX_JSON_BYTES=1_000_000;
const CREATE_RENTAL=new RegExp(`^${API_PREFIX}/rentals/?$`);
const RENTAL_PAYMENT=new RegExp(`^${API_PREFIX}/rentals/([^/]+)/payments/?$`);

function json(body,status=200,headers={}){return new Response(JSON.stringify(body),{status,headers:{...JSON_HEADERS,...headers}});}
function session(value){return value?.installationId&&value?.userId?value:null;}
function operationKey(request){const key=String(request.headers.get('idempotency-key')??'').trim();return key&&key.length<=160?key:null;}
async function readJson(request){
  if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')??''))throw Object.assign(new Error('content_type'),{status:415});
  const declared=Number(request.headers.get('content-length')||0);if(declared>MAX_JSON_BYTES)throw Object.assign(new Error('payload_too_large'),{status:413});
  const text=await request.text();if(new TextEncoder().encode(text).byteLength>MAX_JSON_BYTES)throw Object.assign(new Error('payload_too_large'),{status:413});
  try{return JSON.parse(text||'{}');}catch{throw Object.assign(new Error('invalid_json'),{status:400});}
}
function statusFor(error){
  if(error?.status)return error.status;
  if(error?.code==='reservation_conflict'||error?.code==='payment_exceeds_balance')return 409;
  if(error?.code==='customer_not_found'||error?.code==='rental_not_found')return 404;
  if(error?.code==='vehicle_unavailable')return 409;
  if(error?.code==='daily_schedule_required')return 409;
  if(/required$|^invalid_|_invalid$/.test(error?.code??''))return 400;
  return 500;
}

export function isRentalOperationRoute(request){
  const path=new URL(request.url).pathname;
  return request.method.toUpperCase()==='POST'&&(CREATE_RENTAL.test(path)||RENTAL_PAYMENT.test(path));
}

export async function handleRentalRoute(request,env,_ctx,{auth=null}={}){
  const method=request.method.toUpperCase(),url=new URL(request.url),path=url.pathname;
  if(method!=='POST'||(!CREATE_RENTAL.test(path)&&!RENTAL_PAYMENT.test(path)))return json({ok:false,error:'not_found'},404);
  const actor=session(auth);if(!actor)return json({ok:false,error:'unauthorized'},401);
  const paymentMatch=path.match(RENTAL_PAYMENT),permission=paymentMatch?'finance.write':'rental.write';
  if(!canCloud(actor,permission))return json({ok:false,error:'forbidden'},403);
  if(!env?.DB?.prepare||typeof env.DB.batch!=='function')return json({ok:false,error:'database_unavailable'},503);
  const key=operationKey(request);if(!key)return json({ok:false,error:'idempotency_key_required'},400);
  try{
    const input=await readJson(request),context={db:env.DB,auth:actor};
    const outcome=paymentMatch
      ?await recordRentalPaymentOperation(context,{...input,rentalId:decodeURIComponent(paymentMatch[1])},key)
      :await createRentalOperation(context,input,key);
    return json({ok:true,item:outcome.result,replayed:Boolean(outcome.replayed)},outcome.replayed?200:201);
  }catch(error){
    const status=statusFor(error);
    if(status===500)console.error('rental operation error',error);
    return json({ok:false,error:error?.code??error?.message??'internal_error'},status);
  }
}
