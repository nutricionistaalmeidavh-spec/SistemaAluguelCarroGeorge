const DB_NAME='artisys-locadora-george-offline-blobs';
const STORE_NAME='blobs';

function cloneMeta(value){return value==null?{}:(typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value)));}

function openIndexedDb(indexedDBImpl,dbName,storeName){
  return new Promise((resolve,reject)=>{
    if(!indexedDBImpl){reject(new Error('indexeddb_unavailable'));return;}
    const request=indexedDBImpl.open(dbName,1);
    request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(storeName))db.createObjectStore(storeName,{keyPath:'id'});};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error('offline_blob_db_open_failed'));
  });
}

async function indexedDbBackend({indexedDBImpl=globalThis.indexedDB,dbName=DB_NAME,storeName=STORE_NAME}={}){
  const db=await openIndexedDb(indexedDBImpl,dbName,storeName);
  const tx=(mode,operation)=>new Promise((resolve,reject)=>{
    const transaction=db.transaction(storeName,mode),store=transaction.objectStore(storeName),request=operation(store);
    request.onsuccess=()=>resolve(request.result??null);
    request.onerror=()=>reject(request.error||new Error('offline_blob_operation_failed'));
    transaction.onabort=()=>reject(transaction.error||new Error('offline_blob_transaction_aborted'));
  });
  return Object.freeze({
    async put(id,value){await tx('readwrite',store=>store.put({id:String(id),...value}));return true;},
    async get(id){const record=await tx('readonly',store=>store.get(String(id)));if(!record)return null;const {id:_id,...value}=record;return value;},
    async remove(id){await tx('readwrite',store=>store.delete(String(id)));return true;},
    async has(id){return Boolean(await tx('readonly',store=>store.getKey(String(id))));},
    async list(){return(await tx('readonly',store=>store.getAllKeys())).map(String);},
    close(){db.close();}
  });
}

export function createOfflineBlobStore({backend=null,indexedDBImpl=globalThis.indexedDB,dbName=DB_NAME,storeName=STORE_NAME}={}){
  let backendPromise=backend?Promise.resolve(backend):indexedDbBackend({indexedDBImpl,dbName,storeName});
  const storage=()=>backendPromise;
  return Object.freeze({
    kind:'offline-blob-store',
    async put(attachmentId,blob,meta={}){
      const id=String(attachmentId||'');if(!id)throw new Error('attachment_id_required');
      if(!(blob instanceof Blob))throw new TypeError('blob_required');
      const value={blob,meta:cloneMeta(meta),size:blob.size,type:blob.type||String(meta.mimeType||'application/octet-stream'),storedAt:new Date().toISOString()};
      await(await storage()).put(id,value);return{id,...cloneMeta(value.meta),size:value.size,type:value.type};
    },
    async get(attachmentId){const value=await(await storage()).get(String(attachmentId));return value?{...value,meta:cloneMeta(value.meta)}:null;},
    async remove(attachmentId){return(await storage()).remove(String(attachmentId));},
    async has(attachmentId){return(await storage()).has(String(attachmentId));},
    async list(){return(await storage()).list();},
    async close(){const value=await storage();value.close?.();backendPromise=Promise.resolve(value);}
  });
}
