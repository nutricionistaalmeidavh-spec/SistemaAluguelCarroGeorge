import { createSyncMeta, markSyncFailure, markSyncSuccess, normalizeSyncUrl } from '../domain/sync.mjs';
import { createOfflineState, markOfflineSynced, queueSnapshot } from '../domain/offline.mjs';

export const SYNC_META_KEY='sync:meta:v1';
export const SYNC_CONFLICT_KEY='sync:conflict:v1';
export const SYNC_OFFLINE_KEY='sync:offline:v1';

export function createSyncClient({store,fetchImpl=fetch,deviceId=null}={}){
  if(!store?.get||!store?.set||!store?.remove)throw new TypeError('SQLite store is required.');
  let meta=createSyncMeta({deviceId:deviceId||undefined});
  let offline=createOfflineState();
  let conflict=null;
  let queue=Promise.resolve();
  const enqueue=(task)=>{queue=queue.catch(()=>{}).then(task);queue.catch(()=>{});return queue;};

  async function init(){
    const [rawMeta,rawOffline,rawConflict]=await Promise.all([store.get(SYNC_META_KEY),store.get(SYNC_OFFLINE_KEY),store.get(SYNC_CONFLICT_KEY)]);
    if(rawMeta){try{meta=createSyncMeta(JSON.parse(rawMeta));}catch{}}
    if(rawOffline){try{offline=createOfflineState(JSON.parse(rawOffline));}catch{}}
    if(rawConflict){try{conflict=JSON.parse(rawConflict);}catch{conflict=null;}}
    return api;
  }
  function persistMeta(){enqueue(()=>store.set(SYNC_META_KEY,JSON.stringify(meta)));return meta;}
  function persistOffline(){enqueue(()=>store.set(SYNC_OFFLINE_KEY,JSON.stringify(offline)));return offline;}
  function load(){return meta;}
  function offlineState(){return offline;}
  function markDirty(snapshot){offline=queueSnapshot(offline,snapshot);persistOffline();return offline;}
  function configure(patch={}){
    meta=createSyncMeta({...meta,...patch,deviceId:meta.deviceId||deviceId||undefined,serverUrl:patch.serverUrl!=null?normalizeSyncUrl(patch.serverUrl):meta.serverUrl});
    persistMeta();return meta;
  }
  async function flush(){await queue;await store.flush?.();}
  async function sync(snapshot){
    await flush();
    if(!meta.enabled||!meta.serverUrl||!meta.token)return {ok:false,skipped:true,snapshot,meta,offline};
    try{
      const response=await fetchImpl(`${meta.serverUrl}/api/sync/exchange`,{method:'POST',headers:{'content-type':'application/json','x-locadora-sync-token':meta.token},body:JSON.stringify({baseRevision:meta.revision,deviceId:meta.deviceId,snapshot})});
      if(!response.ok){let detail='';try{detail=(await response.json())?.error||'';}catch{}throw new Error(detail||`Sincronização falhou (${response.status}).`);}
      const data=await response.json();
      if(data.conflict&&['pull','merge'].includes(data.action)){conflict=snapshot;await store.set(SYNC_CONFLICT_KEY,JSON.stringify(conflict));}
      meta=markSyncSuccess(meta,{revision:data.revision,direction:data.action,at:new Date().toISOString()});
      offline=markOfflineSynced(offline,{revision:data.revision,at:meta.lastSyncAt});
      await Promise.all([store.set(SYNC_META_KEY,JSON.stringify(meta)),store.set(SYNC_OFFLINE_KEY,JSON.stringify(offline))]);
      const nextSnapshot=['pull','merge'].includes(data.action)&&data.snapshot?data.snapshot:snapshot;
      return {ok:true,snapshot:nextSnapshot,meta,offline,conflict:Boolean(data.conflict),direction:data.action};
    }catch(error){
      meta=markSyncFailure(meta,error);await store.set(SYNC_META_KEY,JSON.stringify(meta));
      return {ok:false,snapshot,meta,offline,error};
    }
  }
  function clearConflict(){conflict=null;enqueue(()=>store.remove(SYNC_CONFLICT_KEY));}
  function getConflict(){return conflict;}
  const api={init,load,configure,sync,markDirty,offlineState,clearConflict,getConflict,flush};
  return api;
}
