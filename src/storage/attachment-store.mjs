const DB_NAME='artisys-locadora-george-attachments';
const STORE='attachments';

function toUint8Array(value){
  if(value instanceof Uint8Array)return value;
  if(value instanceof ArrayBuffer)return new Uint8Array(value);
  if(ArrayBuffer.isView(value))return new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
  throw new TypeError('Conteúdo do attachment deve ser binário.');
}
async function blobBytes(value){
  if(value instanceof Blob)return new Uint8Array(await value.arrayBuffer());
  return toUint8Array(value);
}
function openDb(){
  return new Promise((resolve,reject)=>{
    if(!globalThis.indexedDB)return reject(new Error('IndexedDB indisponível para attachments.'));
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE,{keyPath:'id'});};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error('Falha ao abrir IndexedDB de attachments.'));
  });
}
async function createBrowserStore(){
  const db=await openDb();
  const request=(mode,fn)=>new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,mode),store=tx.objectStore(STORE),req=fn(store);
    req.onsuccess=()=>resolve(req.result??null);req.onerror=()=>reject(req.error||new Error('Falha no armazenamento de attachment.'));
    tx.onabort=()=>reject(tx.error||new Error('Transação de attachment cancelada.'));
  });
  return Object.freeze({
    kind:'indexeddb-attachments',
    async put(input){
      const bytes=await blobBytes(input.bytes);const record={...input,bytes,createdAt:input.createdAt??new Date().toISOString()};
      await request('readwrite',store=>store.put(record));
      return {id:record.id,entityType:record.entityType,entityId:record.entityId,mimeType:record.mimeType,sizeBytes:bytes.byteLength,createdAt:record.createdAt,status:'local-pending'};
    },
    async get(id){const record=await request('readonly',store=>store.get(String(id)));return record?.bytes??null;},
    async remove(id){await request('readwrite',store=>store.delete(String(id)));return true;},
    async listByEntity(entityType,entityId){
      const all=await request('readonly',store=>store.getAll());
      return (all??[]).filter(item=>item.entityType===entityType&&item.entityId===entityId).map(({bytes,...metadata})=>({...metadata,sizeBytes:bytes?.byteLength??0,status:'local-pending'}));
    },
    close(){db.close();}
  });
}

async function createDesktopStore(bridge){
  return Object.freeze({
    kind:'desktop-attachments',
    async put(input){const bytes=await blobBytes(input.bytes);return bridge.putAttachment({...input,bytes});},
    async get(id){const value=await bridge.getAttachment(String(id));return value==null?null:toUint8Array(value);},
    verify:(id)=>bridge.verifyAttachment(String(id)),
    remove:(id)=>bridge.removeAttachment(String(id)),
    listByEntity:(entityType,entityId)=>bridge.listAttachments(String(entityType),String(entityId)),
    close(){}
  });
}

export async function createAttachmentStore(){
  const bridge=globalThis.window?.locadoraDesktop;
  if(bridge?.putAttachment&&bridge?.getAttachment&&bridge?.removeAttachment)return createDesktopStore(bridge);
  return createBrowserStore();
}
