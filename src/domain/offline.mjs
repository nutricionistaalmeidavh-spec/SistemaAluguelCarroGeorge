function clone(value){return value==null?value:(typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value)));}
function iso(value){const date=new Date(value??Date.now());if(Number.isNaN(date.getTime()))throw new TypeError('Data inválida.');return date.toISOString();}
function idFor(snapshot){const stamp=String(snapshot?.updatedAt??Date.now()).replace(/\D/g,'').slice(0,17)||String(Date.now());return `OFF-${stamp}`;}

export const OFFLINE_OPERATION_STATES=Object.freeze(['pending','sending','synced','conflict','failed']);

export function createOfflineState(input={}){
  return {
    dirty:Boolean(input.dirty),
    dirtySince:input.dirtySince??null,
    pending:Array.isArray(input.pending)?input.pending.map(item=>({...item,snapshot:clone(item.snapshot)})):[],
    lastSyncedAt:input.lastSyncedAt??null,
    lastSyncedRevision:Math.max(0,Number(input.lastSyncedRevision)||0)
  };
}

export function markOfflineDirty(state,options={}){
  const current=createOfflineState(state);
  return {...current,dirty:true,dirtySince:current.dirtySince??iso(options.at)};
}

export function queueSnapshot(state,snapshot,options={}){
  if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot))throw new TypeError('snapshot is required.');
  const current=markOfflineDirty(state,{at:options.at});
  const item={id:String(options.id??idFor(snapshot)),queuedAt:iso(options.at),snapshot:clone(snapshot)};
  return {...current,pending:[item]};
}

export function dequeueSnapshot(state,id){
  const current=createOfflineState(state);
  return {...current,pending:current.pending.filter(item=>item.id!==String(id))};
}

export function markOfflineSynced(state,options={}){
  const current=createOfflineState(state);
  return {...current,dirty:false,dirtySince:null,pending:[],lastSyncedAt:iso(options.at),lastSyncedRevision:Math.max(0,Number(options.revision)||0)};
}

export function pendingCount(state){return createOfflineState(state).pending.length;}

export function summarizeOfflineOperations(items=[]){
  const counts={pending:0,sending:0,synced:0,conflict:0,failed:0};
  for(const item of Array.isArray(items)?items:[]){const status=OFFLINE_OPERATION_STATES.includes(item?.status)?item.status:'failed';counts[status]++;}
  return Object.freeze({total:Object.values(counts).reduce((sum,value)=>sum+value,0),...counts,needsSync:counts.pending+counts.sending+counts.failed,blocked:counts.conflict});
}
