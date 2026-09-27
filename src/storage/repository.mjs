import { createEmptySnapshot, migrateLegacySnapshot } from '../domain/rental.mjs';
import { ensureCommercialSnapshot } from '../domain/commercial.mjs';
import { syncMaintenanceAvailability } from '../domain/maintenance.mjs';
import { createApiClient } from '../api/client.mjs';
import { createPwaSqliteStore } from './pwa-sqlite.mjs';
import { createAttachmentStore } from './attachment-store.mjs';
import { createCacheStore } from './cache-store.mjs';
import { createCloudRepository } from './cloud-repository.mjs';

export const STORE_KEY='app:snapshot:v3';

function normalize(raw){
  const source=typeof raw==='string'?JSON.parse(raw):raw;
  if(!source)return syncMaintenanceAvailability(ensureCommercialSnapshot(createEmptySnapshot()));
  const base=Number(source?.version)>=2&&Array.isArray(source?.ledger)&&Array.isArray(source?.audit)?source:migrateLegacySnapshot(source);
  return syncMaintenanceAvailability(ensureCommercialSnapshot(base));
}

async function createDesktopStore(){
  const bridge=globalThis.window?.locadoraDesktop;
  if(!bridge?.dbGet||!bridge?.dbSet||!bridge?.dbRemove)return null;
  const hasSnapshotBridge=Boolean(bridge.snapshotLoad&&bridge.snapshotSave);
  return Object.freeze({
    kind:'sqlite-desktop',
    get:(key)=>hasSnapshotBridge&&String(key)===STORE_KEY?bridge.snapshotLoad():bridge.dbGet(String(key)),
    set:(key,value)=>hasSnapshotBridge&&String(key)===STORE_KEY?bridge.snapshotSave(String(value)):bridge.dbSet(String(key),String(value)),
    remove:(key)=>bridge.dbRemove(String(key)),
    flush:async()=>true
  });
}

export function isCloudRuntime(documentRef=globalThis.document){
  return String(documentRef?.querySelector?.('meta[name="locadora-runtime"]')?.getAttribute?.('content')??'').toLowerCase()==='cloud';
}

export async function createCloudRuntimeRepository({store=null,baseUrl='',fetchImpl=globalThis.fetch,maxRetries=1,retryDelayMs=250}={}){
  const backing=store??await createPwaSqliteStore();
  const cache=createCacheStore({store:backing});
  const api=createApiClient({baseUrl,fetchImpl,maxRetries,retryDelayMs,onUnauthorized:()=>cache.clearSession()});
  const cloud=createCloudRepository({api,cache});
  return Object.freeze({...cloud,api,kv:backing});
}

export async function createRepository({onPersistenceError=()=>{}}={}){
  const storage=await createDesktopStore()??await createPwaSqliteStore();
  const attachments=await createAttachmentStore();
  const raw=await storage.get(STORE_KEY);
  let cache=normalize(raw);
  if(raw==null||Number((typeof raw==='string'?JSON.parse(raw):raw)?.version||0)<4)await storage.set(STORE_KEY,JSON.stringify(cache));
  let writeQueue=Promise.resolve();

  const failedWrites=new Map();
  const enqueue=(key,task)=>{
    writeQueue=writeQueue.catch(()=>{}).then(task).then(value=>{failedWrites.delete(key);return value;},error=>{failedWrites.set(key,error);throw error;});
    writeQueue.catch(error=>{try{onPersistenceError(error);}catch{}});
    return writeQueue;
  };
  const persist=(value)=>{
    const serialized=JSON.stringify(value);
    enqueue(STORE_KEY,()=>storage.set(STORE_KEY,serialized));
    return value;
  };

  const flush=async()=>{
    await writeQueue.catch(()=>{});
    if(failedWrites.size)throw failedWrites.values().next().value;
    await storage.flush?.();
  };
  const kv=Object.freeze({
    kind:storage.kind,
    get:(key)=>storage.get(key),
    set:(key,value)=>{return enqueue(key,()=>storage.set(key,String(value)));},
    remove:(key)=>{return enqueue(key,()=>storage.remove(key));},
    flush
  });

  return Object.freeze({
    kind:storage.kind,
    attachments,
    load(){return cache;},
    save(snapshot){cache=normalize(snapshot);persist(cache);return cache;},
    flush,
    async reset(){cache=normalize(null);await storage.remove(STORE_KEY);await storage.set(STORE_KEY,JSON.stringify(cache));return cache;},
    kv
  });
}

export async function createRuntimeRepository(options={}){
  if(options.mode==='cloud'||(options.mode==null&&isCloudRuntime(options.documentRef)))return createCloudRuntimeRepository(options);
  return createRepository(options);
}
