import { API_PREFIX } from '../config.mjs';
import { canCloud } from '../auth/permissions.mjs';
import { createRentalOperation,advanceRentalOperation,closeContinuousRentalOperation } from '../domain/rentals.mjs';
import { recordRentalPaymentOperation } from '../domain/payments.mjs';

const JSON_HEADERS=Object.freeze({'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
const MAX_JSON_BYTES=1_000_000;
const CREATE_RENTAL=new RegExp(`^${API_PREFIX}/rentals/?$`);
const RENTAL_PAYMENT=new RegExp(`^${API_PREFIX}/rentals/([^/]+)/payments/?$`);
const RENTAL_ADVANCE=new RegExp(`^${API_PREFIX}/rentals/([^/]+)/advance/?$`);
const RENTAL_CLOSE_CONTINUOUS=new RegExp(`^${API_PREFIX}/rentals/([^/]+)/close-continuous/?$`);

function json(body,status=200,headers={}){return new Response(JSON.stringify(body),{status,headers:{...JSON_HEADERS,...headers}});}
function session(value){return value?.installationId&&value?.userId?value:null;}
function operationKey(request){const key=String(request.headers.get('idempotency-key')??'').trim();return key&&key.length<=160?key:null;}
async function readJson(request){if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')??''))throw Object.assign(new Error('content_type'),{status:415});const declared=Number(request.headers.get('content-length')||0);if(declared>MAX_JSON_BYTES)throw Object.assign(new Error('payload_too_large'),{status:413});const text=await request.text();if(new TextEncoder().encode(text).byteLength>MAX_JSON_BYTES)throw Object.assign(new Error('payload_too_large'),{status:413});try{return JSON.parse(text||'{}');}catch{throw Object.assign(new Error('invalid_json'),{status:400});}}
function statusFor(error){if(error?.status)return error.status;if(['reservation_conflict','payment_exceeds_balance','vehicle_unavailable','daily_schedule_required','invalid_rental_transition','pickup_inspection_required','return_inspection_required','continuous_rental_open','continuous_rental_closed','continuous_rental_not_in_use','rental_state_conflict'].includes(error?.code))return 409;if(['customer_not_found','rental_not_found'].includes(error?.code))return 404;if(/required$|^invalid_|_invalid$/.test(error?.code??''))return 400;return 500;}
function routeMatch(path){return{payment:path.match(RENTAL_PAYMENT),advance:path.match(RENTAL_ADVANCE),close:path.match(RENTAL_CLOSE_CONTINUOUS),create:CREATE_RENTAL.test(path)};}

export function isRentalOperationRoute(request){if(request.method.toUpperCase()!=='POST')return false;const match=routeMatch(new URL(request.url).pathname);return Boolean(match.create||match.payment||match.advance||match.close);}

export async function handleRentalRoute(request,env,_ctx,{auth=null}={}){
  const method=request.method.toUpperCase(),path=new URL(request.url).pathname,match=routeMatch(path);if(method!=='POST'||(!match.create&&!match.payment&&!match.advance&&!match.close))return json({ok:false,error:'not_found'},404);
  const actor=session(auth);if(!actor)return json({ok:false,error:'unauthorized'},401);const permission=match.payment?'finance.write':'rental.write';if(!canCloud(actor,permission))return json({ok:false,error:'forbidden'},403);if(!env?.DB?.prepare||typeof env.DB.batch!=='function')return json({ok:false,error:'database_unavailable'},503);
  const key=operationKey(request);if(!key)return json({ok:false,error:'idempotency_key_required'},400);
  try{
    const input=await readJson(request),context={db:env.DB,auth:actor};let outcome,created=false;
    if(match.payment)outcome=await recordRentalPaymentOperation(context,{...input,rentalId:decodeURIComponent(match.payment[1])},key);
    else if(match.advance)outcome=await advanceRentalOperation(context,{...input,rentalId:decodeURIComponent(match.advance[1])},key);
    else if(match.close)outcome=await closeContinuousRentalOperation(context,{...input,rentalId:decodeURIComponent(match.close[1])},key);
    else{outcome=await createRentalOperation(context,input,key);created=true;}
    const status=outcome.replayed?200:(created||match.payment?201:200);return json({ok:true,item:outcome.result,replayed:Boolean(outcome.replayed)},status);
  }catch(error){const status=statusFor(error);if(status===500)console.error('rental operation error',error);return json({ok:false,error:error?.code??error?.message??'internal_error'},status);}
}
