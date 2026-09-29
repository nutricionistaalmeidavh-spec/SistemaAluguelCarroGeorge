function singularResource(kind){const value=String(kind||'').split('.')[0];return({customer:'customers',vehicle:'vehicles',expense:'expenses',inspection:'inspections',maintenance:'maintenance'}[value]??`${value}s`);}
function status(error){return Number(error?.status)||0;}
function retryable(error){const value=status(error);return !value||value===408||value===425||value===429||value>=500;}
function retryAt(now,item,{baseRetryMs=1_000,maxRetryMs=60_000}={}){const attempts=Math.max(1,Number(item?.attempts)||1),delay=Math.min(Math.max(0,Number(maxRetryMs)||0),Math.max(0,Number(baseRetryMs)||0)*(2**Math.max(0,attempts-1)));return new Date(now.getTime()+delay).toISOString();}
function due(item,now){if(item.status==='pending')return true;if(item.status!=='failed'||!item.nextRetryAt)return false;return new Date(item.nextRetryAt).getTime()<=now.getTime();}

async function dispatch(item,{api,blobs}){
  const payload=item.payload??{},operationId=item.operationId,kind=item.kind;
  if(kind==='rental.create')return api.createRental(payload,{operationId});
  if(kind==='rental.payment'){const {rentalId,...data}=payload;if(!rentalId)throw Object.assign(new Error('rental_id_required'),{status:400});return api.payRental(rentalId,data,{operationId});}
  if(kind==='billing.payment'){const {installmentId,...data}=payload;if(!installmentId)throw Object.assign(new Error('installment_id_required'),{status:400});return api.payInstallment(installmentId,data,{operationId});}
  if(kind==='inspection.create')return api.createInspection(payload,{operationId});
  if(kind==='attachment.upload'){
    if(!blobs)throw new Error('blob_store_required');const attachmentId=String(payload.attachmentId||'');if(!attachmentId)throw Object.assign(new Error('attachment_id_required'),{status:400});
    const stored=await blobs.get(attachmentId);if(!stored)throw Object.assign(new Error('offline_blob_missing'),{status:422});const meta=stored.meta??{};
    return api.uploadAttachment(attachmentId,{entityType:meta.entityType,entityId:meta.entityId,mimeType:stored.blob.type||stored.type||meta.mimeType,body:stored.blob,fileName:meta.fileName??''},{operationId});
  }
  if(kind==='attachment.delete'){
    const attachmentId=String(payload.attachmentId||payload.id||'');if(!attachmentId)throw Object.assign(new Error('attachment_id_required'),{status:400});
    await api.deleteAttachment(attachmentId,{operationId});return{id:attachmentId,deleted:true};
  }
  const [entity,action]=String(kind).split('.'),resource=singularResource(kind);
  if(['create','update','delete'].includes(action)&&typeof api.pushSyncOperations==='function'){
    const operation={operationId,kind,baseVersion:null,payload:{}};
    if(action==='create')operation.payload=payload;
    else if(action==='update'){const {id,data,expectedVersion,...rest}=payload;if(!id)throw Object.assign(new Error('entity_id_required'),{status:400});operation.baseVersion=expectedVersion;operation.payload={id,data:data??rest};}
    else{const {id,expectedVersion}=payload;if(!id)throw Object.assign(new Error('entity_id_required'),{status:400});operation.baseVersion=expectedVersion;operation.payload={id};}
    const response=await api.pushSyncOperations([operation],{operationId});return response?.results?.[0]?.item??response?.results?.[0]??response;
  }
  if(action==='create')return api.create(resource,payload,{operationId});
  if(action==='update'){const {id,data,expectedVersion,...rest}=payload;if(!id)throw Object.assign(new Error('entity_id_required'),{status:400});return api.update(resource,id,data??rest,{expectedVersion,operationId});}
  if(action==='delete'){const {id,expectedVersion}=payload;if(!id)throw Object.assign(new Error('entity_id_required'),{status:400});await api.remove(resource,id,{expectedVersion,operationId});return{id,deleted:true};}
  throw Object.assign(new Error(`unsupported_outbox_kind:${entity}.${action}`),{status:400});
}

export async function runOutbox({outbox,api,blobs=null,now=()=>new Date(),baseRetryMs=1_000,maxRetryMs=60_000,limit=25}={}){
  if(!outbox||!api)throw new TypeError('outbox_runner_dependencies_required');const clock=()=>{const value=now();return value instanceof Date?value:new Date(value);};const result={attempted:0,synced:0,failed:0,conflicts:0,skipped:0,stopped:false};const items=await outbox.list();
  for(const candidate of items){if(result.attempted>=Math.max(1,Number(limit)||25))break;const currentTime=clock();if(!due(candidate,currentTime)||candidate.attempts>=candidate.maxAttempts){result.skipped++;continue;}const item=await outbox.markSending(candidate.id);result.attempted++;
    try{const response=await dispatch(item,{api,blobs});await outbox.markSynced(item.id,response);if(item.kind==='attachment.upload'&&blobs)await blobs.remove(item.payload.attachmentId);result.synced++;}
    catch(error){if(status(error)===409){await outbox.markConflict(item.id,error);result.conflicts++;continue;}if(status(error)===401){await outbox.markFailed(item.id,error);result.failed++;result.stopped=true;break;}const canRetry=retryable(error)&&item.attempts<item.maxAttempts;await outbox.markFailed(item.id,error,{nextRetryAt:canRetry?retryAt(currentTime,item,{baseRetryMs,maxRetryMs}):null});result.failed++;}
  }
  await outbox.flush?.();return result;
}
