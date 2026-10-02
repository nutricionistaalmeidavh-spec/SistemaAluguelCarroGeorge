const DEFAULT_CURSOR_KEY='cloud:sync-cursor:v1';
const ENTITY_COLLECTION=Object.freeze({
  customer:'customers',vehicle:'vehicles',rental:'rentals',rentalPayment:'rentalPayments',expense:'expenses',ledger:'ledger',
  inspection:'inspections',inspectionItem:'inspectionItems',maintenance:'maintenance',billingPlan:'billingPlans',billingInstallment:'billingInstallments',
  billingPayment:'billingPayments',collectionAction:'collectionActions',contractTemplate:'contractTemplates',issuedContract:'issuedContracts',alertState:'alertState',appSettings:'appSettings'
});

function cursorValue(value){const parsed=Number(value);return Number.isInteger(parsed)&&parsed>=0?parsed:0;}
function operationId(value){const text=String(value??'').trim();if(!text)throw new Error('operation_id_required');return text;}

export function createCloudSync({api,cache,store,cursorKey=DEFAULT_CURSOR_KEY}={}){
  if(!api?.request||!cache||!store?.get||!store?.set)throw new TypeError('cloud_sync_dependencies_required');
  const key=String(cursorKey||DEFAULT_CURSOR_KEY);
  async function getCursor(){return cursorValue(await store.get(key));}
  async function setCursor(value){const cursor=cursorValue(value);await store.set(key,String(cursor));await store.flush?.();return cursor;}
  async function applyChanges(batch=[]){
    const working=new Map();
    async function rows(collection){if(!working.has(collection))working.set(collection,await cache.getResource(collection));return working.get(collection);}
    async function upsert(collection,item,{existingOnly=false}={}){if(!item?.id)return false;const items=await rows(collection),index=items.findIndex(row=>String(row?.id)===String(item.id));if(index<0){if(existingOnly)return false;items.push(structuredClone(item));return true;}const current=items[index],currentVersion=Number(current?.version??0),nextVersion=Number(item?.version??0);if(currentVersion>nextVersion&&nextVersion>0)return false;items[index]={...current,...structuredClone(item)};return true;}
    async function remove(collection,id){const items=await rows(collection),next=items.filter(row=>String(row?.id)!==String(id));working.set(collection,next);return next.length!==items.length;}
    let applied=0;
    for(const change of batch){
      let changed=false;
      if(change?.entityType==='rentalPayment'&&change.payload?.rental){
        changed=await upsert('rentals',change.payload.rental,{existingOnly:true});
        if(change.payload?.payment?.id)changed=(await upsert('rentalPayments',change.payload.payment))||changed;
      }else if(change?.entityType==='billingPayment'&&change.payload?.rental){
        changed=await upsert('rentals',change.payload.rental,{existingOnly:true});
        if(change.payload?.installment?.id)changed=(await upsert('billingInstallments',change.payload.installment,{existingOnly:true}))||changed;
        if(change.payload?.payment?.id)changed=(await upsert('billingPayments',change.payload.payment))||changed;
      }else{
        const collection=ENTITY_COLLECTION[change?.entityType];
        if(collection){if(change.operation==='delete'||change.payload?.deleted)changed=await remove(collection,change.entityId);else if(change.payload&&typeof change.payload==='object')changed=await upsert(collection,change.payload);}
      }
      if(changed)applied++;
    }
    if(working.size){
      const entries=await Promise.all([...working.entries()].map(async([resource,items])=>({resource,items,meta:await cache.getResourceMeta(resource)})));
      await cache.replaceResources(entries);
    }
    return applied;
  }
  async function pushOperations(operations=[]){if(!Array.isArray(operations))throw new TypeError('operations_required');const results=[];for(const operation of operations){const id=operationId(operation?.operationId),response=await api.request('/api/v1/sync/operations',{method:'POST',body:{operations:[operation]},operationId:id});results.push(...(response?.results??[]));}return results;}
  async function pullChanges({limit=100,maxPages=20}={}){let cursor=await getCursor(),applied=0,pages=0,changes=[];while(pages<Math.max(1,Number(maxPages)||20)){const response=await api.request(`/api/v1/sync/changes?after=${encodeURIComponent(cursor)}&limit=${encodeURIComponent(limit)}`),batch=Array.isArray(response?.changes)?response.changes:[],next=cursorValue(response?.cursor);applied+=await applyChanges(batch);changes.push(...batch);if(next<cursor)throw new Error('sync_cursor_regression');await setCursor(next);cursor=next;pages++;if(!response?.hasMore||batch.length===0)break;}return{applied,cursor,changes,pages};}
  async function resetCursor(){return setCursor(0);}
  return Object.freeze({getCursor,setCursor,pushOperations,pullChanges,resetCursor});
}
