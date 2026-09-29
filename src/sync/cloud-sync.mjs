const DEFAULT_CURSOR_KEY='cloud:sync-cursor:v1';
const ENTITY_COLLECTION=Object.freeze({
  customer:'customers',vehicle:'vehicles',rental:'rentals',rentalPayment:'rentalPayments',expense:'expenses',ledger:'ledger',
  inspection:'inspections',inspectionItem:'inspectionItems',maintenance:'maintenance',billingPlan:'billingPlans',billingInstallment:'billingInstallments',
  billingPayment:'billingPayments',collectionAction:'collectionActions',contractTemplate:'contractTemplates',issuedContract:'issuedContracts',alertState:'alertState'
});

function cursorValue(value){const parsed=Number(value);return Number.isInteger(parsed)&&parsed>=0?parsed:0;}
function operationId(value){const text=String(value??'').trim();if(!text)throw new Error('operation_id_required');return text;}

export function createCloudSync({api,cache,store,cursorKey=DEFAULT_CURSOR_KEY}={}){
  if(!api?.request||!cache||!store?.get||!store?.set)throw new TypeError('cloud_sync_dependencies_required');
  const key=String(cursorKey||DEFAULT_CURSOR_KEY);
  async function getCursor(){return cursorValue(await store.get(key));}
  async function setCursor(value){const cursor=cursorValue(value);await store.set(key,String(cursor));await store.flush?.();return cursor;}
  async function patchCached(collection,patch){
    if(!patch?.id)return false;
    const items=await cache.getResource(collection),current=items.find(item=>String(item?.id)===String(patch.id));
    if(!current)return false;
    await cache.upsertResourceItem(collection,{...current,...patch});return true;
  }
  async function applyChange(change){
    if(change?.entityType==='rentalPayment'&&change.payload?.rental){
      const rentalApplied=await patchCached('rentals',change.payload.rental);
      if(change.payload?.payment?.id)await cache.upsertResourceItem('rentalPayments',change.payload.payment);
      return rentalApplied||Boolean(change.payload?.payment?.id);
    }
    if(change?.entityType==='billingPayment'&&change.payload?.rental){
      const rentalApplied=await patchCached('rentals',change.payload?.rental),installmentApplied=await patchCached('billingInstallments',change.payload?.installment);
      if(change.payload?.payment?.id)await cache.upsertResourceItem('billingPayments',change.payload.payment);
      return rentalApplied||installmentApplied||Boolean(change.payload?.payment?.id);
    }
    const collection=ENTITY_COLLECTION[change?.entityType];if(!collection)return false;
    if(change.operation==='delete'||change.payload?.deleted){await cache.removeResourceItem(collection,change.entityId);return true;}
    if(change.payload&&typeof change.payload==='object'){await cache.upsertResourceItem(collection,change.payload);return true;}
    return false;
  }
  async function pushOperations(operations=[]){
    if(!Array.isArray(operations))throw new TypeError('operations_required');
    const results=[];
    for(const operation of operations){
      const id=operationId(operation?.operationId),response=await api.request('/api/v1/sync/operations',{method:'POST',body:{operations:[operation]},operationId:id});
      results.push(...(response?.results??[]));
    }
    return results;
  }
  async function pullChanges({limit=100,maxPages=20}={}){
    let cursor=await getCursor(),applied=0,pages=0,changes=[];
    while(pages<Math.max(1,Number(maxPages)||20)){
      const response=await api.request(`/api/v1/sync/changes?after=${encodeURIComponent(cursor)}&limit=${encodeURIComponent(limit)}`),batch=Array.isArray(response?.changes)?response.changes:[],next=cursorValue(response?.cursor);
      for(const change of batch){if(await applyChange(change))applied++;changes.push(change);}
      if(next<cursor)throw new Error('sync_cursor_regression');
      await setCursor(next);cursor=next;pages++;
      if(!response?.hasMore||batch.length===0)break;
    }
    return{applied,cursor,changes,pages};
  }
  async function resetCursor(){return setCursor(0);}
  return Object.freeze({getCursor,setCursor,pushOperations,pullChanges,resetCursor});
}
