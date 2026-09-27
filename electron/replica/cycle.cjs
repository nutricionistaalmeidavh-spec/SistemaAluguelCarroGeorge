'use strict';
const crypto=require('node:crypto');
function bytes(value){if(Buffer.isBuffer(value))return value;if(value instanceof ArrayBuffer)return Buffer.from(new Uint8Array(value));if(ArrayBuffer.isView(value))return Buffer.from(value.buffer,value.byteOffset,value.byteLength);return Buffer.from(value);}
function sha256(value){return crypto.createHash('sha256').update(bytes(value)).digest('hex');}
async function replicateAttachment(api,local,meta){const data=bytes(await api.attachment(meta.id));if(sha256(data)!==String(meta.sha256||'').toLowerCase()){const error=new Error('attachment_checksum_mismatch');error.code='attachment_checksum_mismatch';error.attachmentId=meta.id;throw error;}await local.putAttachment(meta,data);}
async function bootstrap(state,api,local){const result=await api.bootstrap();await local.replaceAll(result.snapshot||{});for(const meta of result.attachments||[])await replicateAttachment(api,local,meta);return{...state,initialized:true,cursor:Number(result.cursor)||0,restoreGeneration:Number(result.restoreGeneration)||0,lastSyncAt:new Date().toISOString(),lastError:null};}
async function runReplicaCycle({state={},api,local}={}){
  if(!api||!local)throw new TypeError('replica_dependencies_required');let current={initialized:false,cursor:0,restoreGeneration:0,...state};
  if(!current.initialized)return bootstrap(current,api,local);
  let pages=0;while(pages<10000){const response=await api.changes(Number(current.cursor)||0),serverGeneration=Number(response?.restoreGeneration??current.restoreGeneration);
    if(serverGeneration!==Number(current.restoreGeneration)){if(api.bootstrap)return bootstrap(current,api,local);const error=new Error('restore_generation_mismatch');error.code='restore_generation_mismatch';throw error;}
    const changes=Array.isArray(response?.changes)?response.changes:[];await local.applyChanges(changes);
    for(const change of changes)if(change?.entityType==='attachment'&&change?.payload?.sha256&&!change?.payload?.deleted)await replicateAttachment(api,local,change.payload);
    const next=Number(response?.cursor??current.cursor);if(next<Number(current.cursor))throw Object.assign(new Error('sync_cursor_regression'),{code:'sync_cursor_regression'});
    current={...current,cursor:next,lastSyncAt:new Date().toISOString(),lastError:null};pages++;if(!response?.hasMore)break;
  }
  if(pages>=10000)throw Object.assign(new Error('sync_page_limit'),{code:'sync_page_limit'});return current;
}
exports.runReplicaCycle=runReplicaCycle;exports.sha256=sha256;exports.replicateAttachment=replicateAttachment;
