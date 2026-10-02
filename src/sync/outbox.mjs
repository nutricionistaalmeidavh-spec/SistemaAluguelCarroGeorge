const DEFAULT_KEY='cloud:outbox:v1';
const VALID_STATUS=new Set(['pending','sending','synced','conflict','failed']);

function clone(value){return value==null?value:(typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value)));}
function iso(value){const date=value instanceof Date?value:new Date(value??Date.now());if(Number.isNaN(date.getTime()))throw new TypeError('invalid_date');return date.toISOString();}
function parse(value){if(value==null||value==='')return[];try{const data=JSON.parse(String(value));return Array.isArray(data)?data:[];}catch{return[];}}
function normalizeError(error){
  if(!error)return null;
  return{
    code:String(error.code??error.message??'request_failed'),
    status:Number(error.status)||0,
    message:String(error.message??error.code??'request_failed'),
    details:clone(error.details??error.body??null)
  };
}
function normalizeItem(raw,index=0){
  const status=VALID_STATUS.has(raw?.status)?raw.status:'pending';
  return{
    id:String(raw?.id??''),operationId:String(raw?.operationId??''),kind:String(raw?.kind??''),payload:clone(raw?.payload??{}),
    status,attempts:Math.max(0,Number(raw?.attempts)||0),maxAttempts:Math.max(1,Number(raw?.maxAttempts)||5),
    createdAt:raw?.createdAt??new Date(0).toISOString(),updatedAt:raw?.updatedAt??raw?.createdAt??new Date(0).toISOString(),
    lastAttemptAt:raw?.lastAttemptAt??null,nextRetryAt:raw?.nextRetryAt??null,lastError:clone(raw?.lastError??null),result:clone(raw?.result??null),
    sequence:Math.max(0,Number(raw?.sequence)||index+1)
  };
}

export function createOutbox(store,{key=DEFAULT_KEY,now=()=>new Date(),maxAttempts=5}={}){
  if(!store?.get||!store?.set)throw new TypeError('outbox_store_required');
  const storageKey=String(key||DEFAULT_KEY);let writeQueue=Promise.resolve();
  const nowIso=()=>iso(now());
  async function load(){await writeQueue.catch(()=>{});return parse(await store.get(storageKey)).map(normalizeItem).sort((a,b)=>a.sequence-b.sequence);}
  async function persist(items){await store.set(storageKey,JSON.stringify(items));await store.flush?.();return items;}
  function mutate(fn){
    let result;
    writeQueue=writeQueue.catch(()=>{}).then(async()=>{
      const items=parse(await store.get(storageKey)).map(normalizeItem).sort((a,b)=>a.sequence-b.sequence);
      result=await fn(items);await persist(items);return result;
    });
    return writeQueue.then(()=>clone(result));
  }
  function locate(items,id){const index=items.findIndex(item=>item.id===String(id));if(index<0)throw new Error('outbox_item_not_found');return{item:items[index],index};}
  return Object.freeze({
    kind:'durable-outbox',storageKey,maxAttempts:Math.max(1,Number(maxAttempts)||5),
    async enqueue(input={}){
      return mutate(items=>{
        const operationId=String(input.operationId||`OP-${crypto.randomUUID()}`),existing=items.find(item=>item.operationId===operationId&&item.status!=='failed');
        if(existing)return existing;
        const stamp=nowIso(),sequence=(items.at(-1)?.sequence??0)+1,item=normalizeItem({
          id:String(input.id||`Q-${crypto.randomUUID()}`),operationId,kind:String(input.kind||''),payload:input.payload??{},status:'pending',attempts:0,
          maxAttempts:Math.max(1,Number(input.maxAttempts)||Math.max(1,Number(maxAttempts)||5)),createdAt:stamp,updatedAt:stamp,sequence
        },sequence-1);
        if(!item.kind)throw new Error('outbox_kind_required');items.push(item);return item;
      });
    },
    async list({statuses=null}={}){const items=await load();if(!statuses)return clone(items);const allowed=new Set(statuses);return clone(items.filter(item=>allowed.has(item.status)));},
    async get(id){const items=await load();return clone(items.find(item=>item.id===String(id))??null);},
    async markSending(id){return mutate(items=>{const {item}=locate(items,id);if(item.status==='synced'||item.status==='conflict')return item;item.status='sending';item.attempts+=1;item.lastAttemptAt=nowIso();item.updatedAt=item.lastAttemptAt;item.nextRetryAt=null;return item;});},
    async markSynced(id,result=null){return mutate(items=>{const {item}=locate(items,id);if(item.status==='conflict')throw new Error('conflict_requires_resolution');item.status='synced';item.result=clone(result);item.lastError=null;item.nextRetryAt=null;item.updatedAt=nowIso();return item;});},
    async markConflict(id,error){return mutate(items=>{const {item}=locate(items,id);item.status='conflict';item.lastError=normalizeError(error);item.nextRetryAt=null;item.updatedAt=nowIso();return item;});},
    async resolveConflict(id,{strategy}={}){return mutate(items=>{const {item}=locate(items,id);if(item.status!=='conflict')throw new Error('outbox_item_not_conflict');if(strategy!=='accept-cloud')throw new Error('unsupported_conflict_resolution');const conflict=clone(item.lastError),cloud=clone(conflict?.details?.current??null);item.status='synced';item.result={resolution:'accept-cloud',cloud,conflict};item.lastError=null;item.nextRetryAt=null;item.updatedAt=nowIso();return item;});},
    async markFailed(id,error,{nextRetryAt=null}={}){return mutate(items=>{const {item}=locate(items,id);item.status='failed';item.lastError=normalizeError(error);item.nextRetryAt=nextRetryAt?iso(nextRetryAt):null;item.updatedAt=nowIso();return item;});},
    async retry(id,{resetAttempts=false}={}){return mutate(items=>{const {item}=locate(items,id);if(item.status==='synced')return item;if(item.status==='conflict')throw new Error('conflict_requires_resolution');item.status='pending';item.nextRetryAt=null;item.lastError=null;if(resetAttempts)item.attempts=0;item.updatedAt=nowIso();return item;});},
    async discard(id,{reason='user_discarded'}={}){return mutate(items=>{const {item}=locate(items,id);if(!['failed','pending'].includes(item.status))throw new Error('outbox_item_not_discardable');const previousError=clone(item.lastError);item.status='synced';item.result={resolution:'discard-local',reason:String(reason||'user_discarded'),error:previousError};item.lastError=null;item.nextRetryAt=null;item.updatedAt=nowIso();return item;});},
    async pruneSynced(){return mutate(items=>{const before=items.length,next=items.filter(item=>item.status!=='synced');items.splice(0,items.length,...next);return before-next.length;});},
    async summary(){const items=await load(),counts={pending:0,sending:0,synced:0,conflict:0,failed:0};for(const item of items)counts[item.status]=(counts[item.status]??0)+1;return{total:items.length,...counts};},
    async flush(){await writeQueue.catch(()=>{});await store.flush?.();return true;}
  });
}
