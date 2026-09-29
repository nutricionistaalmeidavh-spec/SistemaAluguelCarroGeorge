'use strict';

function createDesktopCloudSyncController({outbox,runOutbox,api,blobs=null,authenticated=()=>false,pull=async()=>null,logger=console}={}){
  if(!outbox?.list||!outbox?.enqueue||!outbox?.summary)throw new TypeError('cloud_sync_outbox_required');
  if(typeof runOutbox!=='function')throw new TypeError('cloud_sync_runner_required');
  if(!api)throw new TypeError('cloud_sync_api_required');
  let inFlight=null;

  async function enqueueOperations(operations=[]){
    const existing=await outbox.list(),known=new Set(existing.map(item=>String(item.operationId||'')).filter(Boolean));
    const queued=[];
    for(const candidate of Array.isArray(operations)?operations:[]){
      const operationId=String(candidate?.operationId||'');
      if(!operationId||known.has(operationId))continue;
      const item=await outbox.enqueue(candidate);known.add(operationId);queued.push(item);
    }
    return{queued:queued.length,items:queued,summary:await outbox.summary()};
  }

  async function doFlush(){
    if(!authenticated())return{skipped:'unauthenticated',summary:await outbox.summary()};
    const result=await runOutbox({outbox,api,blobs});
    if(Number(result?.synced||0)>0){
      try{await pull();}catch(error){logger?.warn?.('cloud sync pull failed',error);}
    }
    return{...result,summary:await outbox.summary()};
  }

  async function flush(){
    if(inFlight)return inFlight;
    inFlight=doFlush().finally(()=>{inFlight=null;});
    return inFlight;
  }

  return Object.freeze({
    enqueueOperations,
    flush,
    status:()=>outbox.summary()
  });
}

module.exports={createDesktopCloudSyncController};
