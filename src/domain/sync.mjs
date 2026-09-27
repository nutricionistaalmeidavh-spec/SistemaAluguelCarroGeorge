function clone(value){return value==null?value:(typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value)));}
function stamp(value){for(const key of ['updatedAt','completedAt','paidAt','createdAt','at','dueAt']){const time=Date.parse(value?.[key]??'');if(Number.isFinite(time))return time;}return 0;}
function snapshotStamp(snapshot){const value=Date.parse(snapshot?.updatedAt??'');return Number.isFinite(value)?value:0;}
function round(value){return Math.round((Number(value||0)+Number.EPSILON)*100)/100;}
const COLLECTIONS=['customers','vehicles','rentals','expenses','users','ledger','audit','inspections','maintenance','contractTemplates','issuedContracts','billingPlans','billingInstallments','collectionActions'];

function compareRestorePoints(a,b){
  const ag=Number(a?.restorePoint?.generation)||0,bg=Number(b?.restorePoint?.generation)||0;
  if(ag!==bg)return ag>bg?1:-1;
  const ai=String(a?.restorePoint?.id||''),bi=String(b?.restorePoint?.id||'');
  return ai===bi?0:ai>bi?1:-1;
}

function mergeCollection(server=[],client=[]){
  const map=new Map();
  for(const item of server||[])if(item?.id!=null)map.set(String(item.id),clone(item));
  for(const item of client||[]){
    if(item?.id==null)continue;
    const id=String(item.id),current=map.get(id);
    if(!current||stamp(item)>stamp(current))map.set(id,clone(item));
    else if(stamp(item)===stamp(current)&&JSON.stringify(item)!==JSON.stringify(current)){
      const a=JSON.stringify(current),b=JSON.stringify(item);if(b>a)map.set(id,clone(item));
    }
  }
  return [...map.values()];
}

function mergePaymentCandidates(server=[],client=[]){
  const map=new Map();
  for(const item of [...(server||[]),...(client||[])]){
    if(!item?.id)continue;
    const id=String(item.id),current=map.get(id);
    if(!current||stamp(item)>stamp(current)||(stamp(item)===stamp(current)&&JSON.stringify(item)>JSON.stringify(current)))map.set(id,clone(item));
  }
  return [...map.values()].sort((a,b)=>stamp(a)-stamp(b)||String(a.id).localeCompare(String(b.id)));
}

function conflictPaymentId(conflict){return String(conflict?.payment?.id??conflict?.paymentId??conflict?.id??'');}
function mergeExistingConflicts(server=[],client=[]){
  const map=new Map();
  for(const conflict of [...(server||[]),...(client||[])]){
    const paymentId=conflictPaymentId(conflict);if(!paymentId)continue;
    if(!map.has(paymentId))map.set(paymentId,clone(conflict));
  }
  return map;
}

function mergeScheduleInstallment(serverItem,clientItem){
  const primary=stamp(clientItem)>stamp(serverItem)?clientItem:stamp(clientItem)<stamp(serverItem)?serverItem:(JSON.stringify(clientItem)>JSON.stringify(serverItem)?clientItem:serverItem);
  const merged=clone(primary);
  const conflictMap=mergeExistingConflicts(serverItem?.paymentConflicts,clientItem?.paymentConflicts);
  const blockedIds=new Set(conflictMap.keys());
  const capacity=Math.max(0,Number(merged.amount||serverItem?.amount||clientItem?.amount||0));
  const accepted=[];let total=0;
  for(const payment of mergePaymentCandidates(serverItem?.payments,clientItem?.payments)){
    const id=String(payment.id);
    if(blockedIds.has(id))continue;
    const value=round(payment.amount);
    if(!(value>0))continue;
    if(total+value<=capacity+0.001){accepted.push(payment);total=round(total+value);continue;}
    conflictMap.set(id,{id:`SYNC-${id}`,reason:'concurrent_overpayment',payment:clone(payment),detectedAt:payment.paidAt??merged.updatedAt??merged.createdAt??new Date(0).toISOString()});
  }
  merged.payments=accepted;
  merged.paidAmount=total;
  merged.status=total>=capacity-0.001&&capacity>0?'paid':total>0?'partial':(merged.status==='cancelled'?'cancelled':'open');
  merged.paymentConflicts=[...conflictMap.values()].sort((a,b)=>conflictPaymentId(a).localeCompare(conflictPaymentId(b)));
  merged.syncConflict=merged.paymentConflicts.length>0;
  const latestPayment=accepted.reduce((latest,payment)=>stamp(payment)>stamp(latest)?payment:latest,null);
  if(latestPayment)merged.updatedAt=latestPayment.paidAt??merged.updatedAt;
  return merged;
}

function mergeBillingInstallments(server=[],client=[],rentalSchedulePlanIds=new Set()){
  const left=new Map((server||[]).filter(item=>item?.id!=null).map(item=>[String(item.id),item]));
  const right=new Map((client||[]).filter(item=>item?.id!=null).map(item=>[String(item.id),item]));
  const ids=new Set([...left.keys(),...right.keys()]),result=[];
  for(const id of ids){
    const a=left.get(id),b=right.get(id);
    if(!a){result.push(clone(b));continue;}
    if(!b){result.push(clone(a));continue;}
    if(rentalSchedulePlanIds.has(a.planId)||rentalSchedulePlanIds.has(b.planId))result.push(mergeScheduleInstallment(a,b));
    else result.push(mergeCollection([a],[b])[0]);
  }
  return result;
}

function reconcileRentalSchedules(snapshot){
  const plans=(snapshot.billingPlans??[]).filter(plan=>plan.purpose==='rental_schedule'&&plan.active!==false);
  for(const plan of plans){
    const schedule=(snapshot.billingInstallments??[]).filter(item=>item.planId===plan.id&&item.status!=='cancelled').sort((a,b)=>Number(a.sequence||0)-Number(b.sequence||0));
    const rental=(snapshot.rentals??[]).find(item=>item.id===plan.rentalId);if(!rental)continue;
    for(const item of schedule){
      const ledger=(snapshot.ledger??[]).find(entry=>entry.kind==='billing_receivable'&&entry.installmentId===item.id);
      if(ledger){ledger.paidAmount=Number(item.paidAmount||0);ledger.status=item.status==='paid'?'paid':Number(item.paidAmount||0)>0?'partial':'open';const latest=(item.payments??[]).reduce((value,payment)=>stamp(payment)>stamp(value)?payment:value,null);if(ledger.status==='paid'&&latest)ledger.paidAt=latest.paidAt;else if(ledger.status!=='paid')delete ledger.paidAt;}
    }
    if(rental.periodMode==='continuous'||plan.generationMode==='continuous'){
      rental.days=schedule.length;
      rental.total=round(schedule.reduce((sum,item)=>sum+Number(item.amount||0),0));
      plan.occurrences=schedule.length;
    }
    rental.payments=schedule.flatMap(item=>(item.payments??[]).map(payment=>({...clone(payment),installmentId:item.id}))).sort((a,b)=>stamp(a)-stamp(b)||String(a.id).localeCompare(String(b.id)));
    const paid=round(schedule.reduce((sum,item)=>sum+Math.min(Number(item.amount||0),Number(item.paidAmount||0)),0));
    rental.paymentStatus=paid>=Number(rental.total||0)-0.001?'pago':'aberto';
    const parent=(snapshot.ledger??[]).find(entry=>entry.kind==='receivable'&&entry.rentalId===rental.id);
    if(parent){parent.amount=Number(rental.total||parent.amount||0);parent.paidAmount=Math.min(Number(parent.amount||0),paid);parent.status=parent.paidAmount>=Number(parent.amount||0)-0.001?'paid':parent.paidAmount>0?'partial':'open';const latest=rental.payments[rental.payments.length-1];if(parent.status==='paid'&&latest)parent.paidAt=latest.paidAt;else if(parent.status!=='paid')delete parent.paidAt;}
  }
  return snapshot;
}

function alertStamp(value){const time=Date.parse(value?.updatedAt??value?.at??'');return Number.isFinite(time)?time:0;}
function mergeAlertState(server={},client={}){
  const merged={...clone(server||{})};
  for(const [id,value] of Object.entries(client||{})){
    const current=merged[id];
    if(current==null||alertStamp(value)>alertStamp(current))merged[id]=clone(value);
    else if(alertStamp(value)===alertStamp(current)&&JSON.stringify(value)>JSON.stringify(current))merged[id]=clone(value);
  }
  return merged;
}

export function mergeSnapshots(serverSnapshot,clientSnapshot){
  if(!serverSnapshot)return clone(clientSnapshot);
  if(!clientSnapshot)return clone(serverSnapshot);
  const restoration=compareRestorePoints(clientSnapshot,serverSnapshot);
  if(restoration!==0)return clone(restoration>0?clientSnapshot:serverSnapshot);
  const server=clone(serverSnapshot),client=clone(clientSnapshot);
  const merged={...server};
  for(const key of COLLECTIONS){
    if(key==='billingInstallments')continue;
    if(Array.isArray(server[key])||Array.isArray(client[key]))merged[key]=mergeCollection(server[key],client[key]);
  }
  const schedulePlanIds=new Set((merged.billingPlans??[]).filter(plan=>plan.purpose==='rental_schedule').map(plan=>plan.id));
  merged.billingInstallments=mergeBillingInstallments(server.billingInstallments,client.billingInstallments,schedulePlanIds);
  merged.alertState=mergeAlertState(server.alertState,client.alertState);
  const clientNewer=snapshotStamp(client)>snapshotStamp(server);
  merged.settings=clone(clientNewer?client.settings??server.settings:server.settings??client.settings);
  merged.version=Math.max(Number(server.version)||0,Number(client.version)||0);
  merged.updatedAt=new Date(Math.max(snapshotStamp(server),snapshotStamp(client),Date.now())).toISOString();
  return reconcileRentalSchedules(merged);
}

function canEntityMerge(a,b){return COLLECTIONS.some(key=>Array.isArray(a?.[key])||Array.isArray(b?.[key]));}

export function exchangeSnapshots({serverRevision=0,serverSnapshot=null,baseRevision=0,clientSnapshot}={}){
  if(!clientSnapshot||typeof clientSnapshot!=='object'||Array.isArray(clientSnapshot))throw new TypeError('clientSnapshot is required.');
  const currentRevision=Math.max(0,Number(serverRevision)||0),knownRevision=Math.max(0,Number(baseRevision)||0);
  if(!serverSnapshot)return {action:'push',snapshot:clone(clientSnapshot),nextRevision:Math.max(1,currentRevision+1),conflict:false};
  const restoration=compareRestorePoints(clientSnapshot,serverSnapshot);
  if(restoration>0)return {action:'push',snapshot:clone(clientSnapshot),nextRevision:currentRevision+1,conflict:true};
  if(restoration<0)return {action:'pull',snapshot:clone(serverSnapshot),nextRevision:currentRevision,conflict:true};
  if(knownRevision===currentRevision){
    if(snapshotStamp(clientSnapshot)<snapshotStamp(serverSnapshot))return {action:'pull',snapshot:clone(serverSnapshot),nextRevision:currentRevision,conflict:false};
    return {action:'push',snapshot:clone(clientSnapshot),nextRevision:currentRevision+1,conflict:false};
  }
  if(canEntityMerge(serverSnapshot,clientSnapshot))return {action:'merge',snapshot:mergeSnapshots(serverSnapshot,clientSnapshot),nextRevision:currentRevision+1,conflict:true};
  if(snapshotStamp(clientSnapshot)>snapshotStamp(serverSnapshot))return {action:'push',snapshot:clone(clientSnapshot),nextRevision:currentRevision+1,conflict:true};
  return {action:'pull',snapshot:clone(serverSnapshot),nextRevision:currentRevision,conflict:true};
}

export function normalizeSyncUrl(value){
  const raw=String(value??'').trim();if(!raw)return '';
  let url;try{url=new URL(raw);}catch{throw new Error('Endereço de sincronização inválido.');}
  if(!['http:','https:'].includes(url.protocol))throw new Error('Sincronização aceita apenas HTTP ou HTTPS.');
  url.pathname='/';url.search='';url.hash='';return url.toString().replace(/\/$/,'');
}
export function createDeviceId(prefix='DEV'){
  if(typeof globalThis.crypto?.randomUUID==='function')return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
export function createSyncMeta(input={}){return{deviceId:String(input.deviceId||createDeviceId()),deviceName:String(input.deviceName||''),serverUrl:normalizeSyncUrl(input.serverUrl||''),token:String(input.token||''),enabled:Boolean(input.enabled),autoSync:Boolean(input.autoSync),revision:Math.max(0,Number(input.revision)||0),lastSyncAt:input.lastSyncAt||null,lastDirection:input.lastDirection||null,lastError:input.lastError||null};}
export function markSyncSuccess(meta,{revision,direction,at=new Date().toISOString()}={}){return{...createSyncMeta(meta),revision:Math.max(0,Number(revision)||0),lastSyncAt:at,lastDirection:direction||null,lastError:null};}
export function markSyncFailure(meta,error,{at=new Date().toISOString()}={}){return{...createSyncMeta(meta),lastError:String(error?.message??error??'Falha de sincronização.'),lastSyncAt:meta?.lastSyncAt??null,lastAttemptAt:at};}
