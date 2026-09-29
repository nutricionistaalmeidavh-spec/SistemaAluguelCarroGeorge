'use strict';
const crypto=require('node:crypto');

const list=value=>Array.isArray(value)?value:[];
const byId=items=>new Map(list(items).filter(item=>item?.id!=null).map(item=>[String(item.id),item]));
function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
function version(item){return Math.max(1,Number(item?.syncVersion??item?.version??1)||1);}
function digest(value){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,20);}
function safeId(value){return String(value??'').replace(/[^A-Za-z0-9._:-]/g,'_').slice(0,80);}
function operation(kind,entityId,payload,suffix=''){
  const tail=suffix?`:${suffix}`:'';
  return{operationId:`desktop:${kind}:${safeId(entityId)}${tail}`.slice(0,160),kind,payload:clone(payload)};
}
function equal(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function compact(object){return Object.fromEntries(Object.entries(object).filter(([,value])=>value!==undefined));}

function customerData(item={}){return compact({
  name:String(item.name??''),document:item.document==null?'':String(item.document),phone:item.phone==null?'':String(item.phone),
  email:item.email==null?'':String(item.email),address:item.address==null?'':String(item.address),
  driverLicenseJson:item.driverLicense==null?undefined:clone(item.driverLicense),active:item.active===false?0:1
});}
function vehicleData(item={}){return compact({
  model:String(item.model??''),plate:String(item.plate??''),year:item.year==null?'':String(item.year),mileage:Number(item.mileage||0),
  category:item.category==null?'':String(item.category),color:item.color==null?'':String(item.color),dailyRate:Number(item.dailyRate||0),
  purchasePrice:Number(item.purchasePrice||0),availability:String(item.availability??'disponivel'),documentsJson:item.documents==null?undefined:clone(item.documents)
});}
function changedFields(before,after){const patch={};for(const [key,value] of Object.entries(after))if(!equal(before?.[key],value))patch[key]=value;return patch;}

function entityOperations(beforeItems,afterItems,{singular,data}){
  const before=byId(beforeItems),after=byId(afterItems),operations=[];
  for(const [id,item] of after){
    const previous=before.get(id),wire=data(item);
    if(!previous){operations.push(operation(`${singular}.create`,id,{id,...wire}));continue;}
    const patch=changedFields(data(previous),wire);if(!Object.keys(patch).length)continue;
    const expectedVersion=version(previous),payload={id,data:patch,expectedVersion};
    operations.push(operation(`${singular}.update`,id,payload,`v${expectedVersion}:${digest(patch)}`));
  }
  for(const [id,item] of before)if(!after.has(id)){const expectedVersion=version(item);operations.push(operation(`${singular}.delete`,id,{id,expectedVersion},`v${expectedVersion}`));}
  return operations;
}
function rentalCreate(item={}){return compact({
  id:String(item.id),customerId:item.customerId,vehicleId:item.vehicleId,attendantId:item.attendantId,
  pickupAt:item.pickupAt,returnAt:item.returnAt??null,periodMode:item.periodMode==='continuous'?'continuous':'fixed',
  priority:item.priority??'Media',notes:item.notes??'',dailyRate:Number(item.dailyRate||0),billingMode:item.billingMode==='daily'?'daily':'total'
});}
function inspectionCreate(item={}){return{
  id:String(item.id),rentalId:item.rentalId,kind:item.kind==='checkout'?'pickup':item.kind,
  mileage:item.mileage??null,fuelLevel:item.fuelLevel??'',notes:item.notes??'',damages:clone(item.damages??[]),
  items:list(item.checklist).map(check=>({key:String(check.id??check.key??''),label:String(check.label??''),done:Boolean(check.done),evidence:check.evidence??null}))
};}
function addedPayments(beforeParents,afterParents,{kind,parentKey}){
  const before=byId(beforeParents),operations=[];
  for(const parent of list(afterParents)){
    if(!parent?.id)continue;const oldPayments=byId(before.get(String(parent.id))?.payments),newPayments=byId(parent.payments);
    for(const [id,payment] of newPayments)if(!oldPayments.has(id))operations.push(operation(kind,id,compact({id,[parentKey]:String(parent.id),amount:Number(payment.amount||0),method:String(payment.method??''),paidAt:payment.paidAt})));
  }
  return operations;
}

function buildCloudOperations(beforeSnapshot={},afterSnapshot={}){
  const before=beforeSnapshot??{},after=afterSnapshot??{},operations=[];
  operations.push(...entityOperations(before.customers,after.customers,{singular:'customer',data:customerData}));
  operations.push(...entityOperations(before.vehicles,after.vehicles,{singular:'vehicle',data:vehicleData}));

  const oldRentals=byId(before.rentals);
  for(const rental of list(after.rentals))if(rental?.id&&!oldRentals.has(String(rental.id)))operations.push(operation('rental.create',rental.id,rentalCreate(rental)));
  operations.push(...addedPayments(before.rentals,after.rentals,{kind:'rental.payment',parentKey:'rentalId'}));
  operations.push(...addedPayments(before.billingInstallments,after.billingInstallments,{kind:'billing.payment',parentKey:'installmentId'}));

  const oldInspections=byId(before.inspections);
  for(const inspection of list(after.inspections)){
    if(!inspection?.id||inspection.status!=='completed')continue;
    const previous=oldInspections.get(String(inspection.id));if(previous?.status==='completed')continue;
    operations.push(operation('inspection.create',inspection.id,inspectionCreate(inspection)));
  }
  return operations;
}

module.exports={buildCloudOperations};
