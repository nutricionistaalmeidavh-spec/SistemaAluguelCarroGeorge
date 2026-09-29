import { canCloud } from '../auth/permissions.mjs';
import { appendChangeStatement } from '../sync/change-log.mjs';

const MAX_ATTACHMENT_BYTES=8*1024*1024;
const MIME_EXT=Object.freeze({
  'image/jpeg':'jpg',
  'image/png':'png',
  'image/webp':'webp',
  'application/pdf':'pdf'
});

function fail(code,message=code){const error=new Error(message);error.code=code;throw error;}
function segment(value,code){const text=String(value??'').trim();if(!/^[A-Za-z0-9_-]{1,120}$/.test(text))fail(code);return text;}
function mime(value){const type=String(value??'').trim().toLowerCase();if(!MIME_EXT[type])fail('attachment_mime_not_allowed');return type;}
function permission(entityType,mode){
  if(entityType==='inspection')return `inspection.${mode}`;
  if(entityType==='contract')return `contracts.${mode}`;
  if(entityType==='document')return mode==='read'?'documents.read':'contracts.write';
  return null;
}
function requireAuth(auth){if(!auth?.installationId||!auth?.userId||auth.active===false||auth.active===0)fail('unauthorized');}
function requirePermission(auth,entityType,mode){const needed=permission(entityType,mode);if(needed&&!canCloud(auth,needed))fail('forbidden');if(!needed&&!canCloud(auth,'*'))fail('forbidden');}
function byteLength(body){
  if(body instanceof ArrayBuffer)return body.byteLength;
  if(ArrayBuffer.isView(body))return body.byteLength;
  if(typeof body==='string')return new TextEncoder().encode(body).byteLength;
  if(body instanceof Blob)return body.size;
  fail('attachment_body_invalid');
}
async function toArrayBuffer(body){
  if(body instanceof ArrayBuffer)return body;
  if(ArrayBuffer.isView(body))return body.buffer.slice(body.byteOffset,body.byteOffset+body.byteLength);
  if(typeof body==='string')return new TextEncoder().encode(body).buffer;
  if(body instanceof Blob)return body.arrayBuffer();
  fail('attachment_body_invalid');
}
function hex(buffer){return [...new Uint8Array(buffer)].map(value=>value.toString(16).padStart(2,'0')).join('');}
function rowToMeta(row){return row?{
  id:row.id,
  installationId:row.installation_id,
  entityType:row.entity_type,
  entityId:row.entity_id,
  objectKey:row.object_key,
  mimeType:row.mime_type,
  sizeBytes:Number(row.size_bytes),
  sha256:row.sha256,
  status:row.status,
  storageBackend:row.storage_backend,
  createdAt:row.created_at,
  createdBy:row.created_by
}:null;}

export function buildAttachmentObjectKey({installationId,entityType,entityId,attachmentId,mimeType}){
  const installation=segment(installationId,'installation_id_invalid');
  const type=segment(entityType,'entity_type_invalid').toLowerCase();
  const entity=segment(entityId,'entity_id_invalid');
  const attachment=segment(attachmentId,'attachment_id_invalid');
  const contentType=mime(mimeType);
  return `installations/${installation}/${type}/${entity}/${attachment}.${MIME_EXT[contentType]}`;
}

export async function putAttachment(env,auth,meta,body){
  requireAuth(auth);
  if(!env?.DB?.prepare||typeof env.DB.batch!=='function')fail('database_unavailable');
  if(!env?.ATTACHMENTS?.put)fail('r2_unavailable');
  const attachmentId=segment(meta?.id,'attachment_id_invalid');
  const entityType=segment(meta?.entityType,'entity_type_invalid').toLowerCase();
  const entityId=segment(meta?.entityId,'entity_id_invalid');
  const mimeType=mime(meta?.mimeType);
  requirePermission(auth,entityType,'write');
  const declared=meta?.sizeBytes==null?null:Number(meta.sizeBytes);
  if(declared!=null&&(!Number.isFinite(declared)||declared<0))fail('attachment_size_invalid');
  if(declared!=null&&declared>MAX_ATTACHMENT_BYTES)fail('attachment_too_large');
  const actualSize=byteLength(body);if(actualSize>MAX_ATTACHMENT_BYTES)fail('attachment_too_large');
  if(declared!=null&&declared!==actualSize)fail('attachment_size_mismatch');
  const data=await toArrayBuffer(body);
  const digest=await crypto.subtle.digest('SHA-256',data),sha256=hex(digest);
  const objectKey=buildAttachmentObjectKey({installationId:auth.installationId,entityType,entityId,attachmentId,mimeType});
  const existing=await env.DB.prepare(`SELECT id, installation_id, entity_type, entity_id, object_key, mime_type, size_bytes, sha256, status, storage_backend, created_at, created_by
    FROM attachments WHERE installation_id = ? AND id = ? AND deleted_at IS NULL LIMIT 1`).bind(auth.installationId,attachmentId).first();
  if(existing){
    if(existing.sha256===sha256&&existing.object_key===objectKey)return rowToMeta(existing);
    fail('attachment_id_conflict');
  }
  await env.ATTACHMENTS.put(objectKey,data,{
    httpMetadata:{contentType:mimeType,cacheControl:'private, max-age=0, no-store'},
    customMetadata:{installationId:String(auth.installationId),entityType,entityId,attachmentId,sha256},
    sha256:digest
  });
  const now=new Date().toISOString();
  const result={id:attachmentId,installationId:auth.installationId,entityType,entityId,objectKey,mimeType,sizeBytes:actualSize,sha256,status:'ready',storageBackend:'r2',createdAt:now,createdBy:auth.userId};
  try{
    const insert=env.DB.prepare(`INSERT INTO attachments
      (id, installation_id, entity_type, entity_id, local_path, mime_type, size_bytes, sha256, created_at, created_by, status, updated_at, version, updated_by_device, object_key, storage_backend)
      VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?, 'ready', ?, 1, ?, ?, 'r2')`)
      .bind(attachmentId,auth.installationId,entityType,entityId,mimeType,actualSize,sha256,now,auth.userId,now,auth.deviceId??null,objectKey);
    const change=appendChangeStatement(env.DB,{operationId:`attachment:${attachmentId}:create:${sha256.slice(0,24)}`,installationId:auth.installationId,deviceId:auth.deviceId??null,entityType:'attachment',entityId:attachmentId,operation:'create',entityVersion:1,payload:result,createdAt:now,guardSql:'EXISTS (SELECT 1 FROM attachments WHERE installation_id = ? AND id = ? AND deleted_at IS NULL)',guardParams:[auth.installationId,attachmentId]});
    const batch=await env.DB.batch([insert,change]);
    if(Number(batch?.[0]?.meta?.changes??0)!==1||Number(batch?.[1]?.meta?.changes??0)!==1)fail('attachment_metadata_write_failed');
  }catch(error){
    try{await env.ATTACHMENTS.delete(objectKey);}catch(cleanupError){error.orphanKey=objectKey;error.cleanupError=cleanupError;}
    throw error;
  }
  return result;
}

export async function getAttachment(env,auth,attachmentId){
  requireAuth(auth);if(!env?.DB?.prepare)fail('database_unavailable');if(!env?.ATTACHMENTS?.get)fail('r2_unavailable');
  const id=segment(attachmentId,'attachment_id_invalid');
  const row=await env.DB.prepare(`SELECT id, installation_id, entity_type, entity_id, object_key, mime_type, size_bytes, sha256, status, storage_backend, created_at, created_by
    FROM attachments WHERE installation_id = ? AND id = ? AND deleted_at IS NULL AND status = 'ready' LIMIT 1`).bind(auth.installationId,id).first();
  if(!row||row.storage_backend!=='r2'||!row.object_key)fail('attachment_not_found');
  requirePermission(auth,row.entity_type,'read');
  const object=await env.ATTACHMENTS.get(row.object_key);if(!object)fail('attachment_object_missing');
  return{metadata:rowToMeta(row),object};
}

export async function deleteAttachment(env,auth,attachmentId){
  requireAuth(auth);if(!env?.DB?.prepare||typeof env.DB.batch!=='function')fail('database_unavailable');if(!env?.ATTACHMENTS?.delete)fail('r2_unavailable');
  const id=segment(attachmentId,'attachment_id_invalid');
  const row=await env.DB.prepare(`SELECT id, entity_type, entity_id, object_key, version, deleted_at FROM attachments WHERE installation_id = ? AND id = ? LIMIT 1`).bind(auth.installationId,id).first();
  if(!row)fail('attachment_not_found');requirePermission(auth,row.entity_type,'write');
  if(row.deleted_at)return{ok:true,id,alreadyDeleted:true};
  if(row.object_key)await env.ATTACHMENTS.delete(row.object_key);
  const now=new Date().toISOString(),nextVersion=Number(row.version||1)+1,payload={id,entityType:row.entity_type,entityId:row.entity_id,deleted:true,version:nextVersion,updatedAt:now,updatedByDevice:auth.deviceId??null};
  const update=env.DB.prepare(`UPDATE attachments SET status = 'deleted', deleted_at = ?, updated_at = ?, version = version + 1, updated_by_device = ?
    WHERE installation_id = ? AND id = ? AND deleted_at IS NULL`).bind(now,now,auth.deviceId??null,auth.installationId,id);
  const change=appendChangeStatement(env.DB,{operationId:`attachment:${id}:delete:v${nextVersion}`,installationId:auth.installationId,deviceId:auth.deviceId??null,entityType:'attachment',entityId:id,operation:'delete',baseVersion:nextVersion-1,entityVersion:nextVersion,payload,createdAt:now,guardSql:'EXISTS (SELECT 1 FROM attachments WHERE installation_id = ? AND id = ? AND deleted_at = ?)',guardParams:[auth.installationId,id,now]});
  const batch=await env.DB.batch([update,change]);
  if(Number(batch?.[0]?.meta?.changes??0)!==1||Number(batch?.[1]?.meta?.changes??0)!==1)fail('attachment_delete_conflict');
  return{ok:true,id};
}

export const attachmentLimits=Object.freeze({maxBytes:MAX_ATTACHMENT_BYTES,mimeTypes:Object.keys(MIME_EXT)});
