const DEFAULT_TIMEOUT_MS=15_000;
const RESOURCE_ENTITY=Object.freeze({customers:'customer',vehicles:'vehicle'});
const RESOURCE_PREFIX=Object.freeze({customers:'CUS',vehicles:'VEI'});

export class ApiError extends Error{
  constructor(message,{status=0,code='api_error',details=null,cause=null}={}){
    super(message,{cause});this.name='ApiError';this.status=Number(status)||0;this.code=code;this.details=details;
  }
}

function sleep(ms){return ms>0?new Promise(resolve=>setTimeout(resolve,ms)):Promise.resolve();}
function normalizeBaseUrl(value){const text=String(value??'').trim();return text.endsWith('/')?text.slice(0,-1):text;}
function resolveUrl(baseUrl,path){const text=String(path??'');if(/^https?:\/\//i.test(text))return text;if(baseUrl)return `${baseUrl}${text.startsWith('/')?'':'/'}${text}`;return text.startsWith('/')?text:`/${text}`;}
function isJson(response){return /(?:^|\/)json(?:;|$)/i.test(response.headers.get('content-type')??'')||/application\/[^;]+\+json/i.test(response.headers.get('content-type')??'');}
function retryable(method,operationId){return ['GET','HEAD','OPTIONS'].includes(method)||Boolean(operationId);}
function syncIdentity(resource){const name=String(resource??''),entity=RESOURCE_ENTITY[name];if(!entity)throw new ApiError('unsupported_sync_resource',{status:400,code:'unsupported_sync_resource'});return{entity,prefix:RESOURCE_PREFIX[name]};}
function generatedOperationId(){return `OP-${crypto.randomUUID()}`;}
function generatedEntityId(prefix){return `${prefix}-${crypto.randomUUID()}`;}

export function createApiClient({baseUrl='',fetchImpl=globalThis.fetch,timeoutMs=DEFAULT_TIMEOUT_MS,maxRetries=1,retryDelayMs=150,onUnauthorized=()=>{}}={}){
  if(typeof fetchImpl!=='function')throw new TypeError('fetchImpl_required');
  const origin=normalizeBaseUrl(baseUrl);

  async function request(path,{method='GET',body,headers={},operationId=null,signal=null}={}){
    const verb=String(method).toUpperCase(),url=resolveUrl(origin,path),canRetry=retryable(verb,operationId);
    let attempt=0;
    while(true){
      const controller=!signal&&timeoutMs>0?new AbortController():null;
      const timer=controller?setTimeout(()=>controller.abort(new DOMException('Request timed out','TimeoutError')),timeoutMs):null;
      const requestHeaders=new Headers(headers);
      requestHeaders.set('accept','application/json');
      if(operationId)requestHeaders.set('idempotency-key',String(operationId));
      let payload=body;
      if(body!==undefined&&body!==null&&!(body instanceof Blob)&&!(body instanceof ArrayBuffer)&&!ArrayBuffer.isView(body)&&typeof body!=='string'){
        requestHeaders.set('content-type','application/json');payload=JSON.stringify(body);
      }
      try{
        const response=await fetchImpl(url,{method:verb,headers:requestHeaders,body:payload,credentials:'include',signal:signal??controller?.signal,cache:'no-store'});
        let data=null;
        if(response.status!==204&&response.status!==205){
          if(isJson(response)){try{data=await response.json();}catch(error){throw new ApiError('invalid_json_response',{status:response.status,code:'invalid_response',cause:error});}}
          else if(response.ok)throw new ApiError('non_json_response',{status:response.status,code:'invalid_response'});
        }
        if(!response.ok){
          const code=data?.error??`http_${response.status}`;
          const error=new ApiError(data?.message??code,{status:response.status,code,details:data});
          if(response.status===401){try{await onUnauthorized(error);}catch{}}
          throw error;
        }
        return data;
      }catch(error){
        const networkError=!(error instanceof ApiError);
        if(networkError&&canRetry&&attempt<maxRetries){attempt++;await sleep(retryDelayMs);continue;}
        throw error;
      }finally{if(timer)clearTimeout(timer);}
    }
  }

  async function syncOperation(operation){
    const opId=String(operation.operationId||generatedOperationId()),payload={...operation,operationId:opId};
    const response=await request('/api/v1/sync/operations',{method:'POST',body:{operations:[payload]},operationId:opId});
    return response?.results?.[0]??null;
  }

  return Object.freeze({
    request,
    async health(){return request('/api/v1/health');},
    async login(input){return request('/api/v1/auth/login',{method:'POST',body:input});},
    async firstAccess(input){return request('/api/v1/auth/first-access',{method:'POST',body:input});},
    async logout(){return request('/api/v1/auth/logout',{method:'POST'});},
    async session(){return request('/api/v1/auth/me');},
    async list(resource){const result=await request(`/api/v1/${encodeURIComponent(resource)}`);return result?.items??[];},
    async get(resource,id){const result=await request(`/api/v1/${encodeURIComponent(resource)}/${encodeURIComponent(id)}`);return result?.item??null;},
    async create(resource,data,{operationId=null}={}){const {entity,prefix}=syncIdentity(resource),payload={...data,id:data?.id??generatedEntityId(prefix)},outcome=await syncOperation({operationId:operationId??generatedOperationId(),kind:`${entity}.create`,payload});return outcome?.item??null;},
    async update(resource,id,data,{expectedVersion,operationId=null}={}){const {entity}=syncIdentity(resource),outcome=await syncOperation({operationId:operationId??generatedOperationId(),kind:`${entity}.update`,baseVersion:expectedVersion,payload:{id,data}});return outcome?.item??null;},
    async remove(resource,id,{expectedVersion,operationId=null}={}){const {entity}=syncIdentity(resource);await syncOperation({operationId:operationId??generatedOperationId(),kind:`${entity}.delete`,baseVersion:expectedVersion,payload:{id}});return true;},
    async createRental(data,{operationId}={}){const result=await request('/api/v1/rentals',{method:'POST',body:data,operationId});return result?.item??result?.result??null;},
    async payRental(rentalId,data,{operationId}={}){const result=await request(`/api/v1/rentals/${encodeURIComponent(rentalId)}/payments`,{method:'POST',body:data,operationId});return result?.item??result?.result??null;},
    async payInstallment(installmentId,data,{operationId}={}){const result=await request(`/api/v1/billing/installments/${encodeURIComponent(installmentId)}/payments`,{method:'POST',body:data,operationId});return result?.item??result?.result??null;},
    async uploadAttachment(id,{entityType,entityId,mimeType,body:fileBody,fileName=''}={}, {operationId}={}){const result=await request(`/api/v1/attachments/${encodeURIComponent(id)}?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`,{method:'PUT',body:fileBody,headers:{'content-type':mimeType,'x-file-name':fileName},operationId});return result?.item??null;}
  });
}
