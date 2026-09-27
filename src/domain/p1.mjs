function clone(value){return typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value));}

export function ensureP1Snapshot(input){
  const snapshot=clone(input??{});
  snapshot.version=Math.max(Number(snapshot.version||0),4);
  snapshot.inspections=Array.isArray(snapshot.inspections)?snapshot.inspections:[];
  snapshot.maintenance=Array.isArray(snapshot.maintenance)?snapshot.maintenance:[];
  snapshot.alertState=snapshot.alertState&&typeof snapshot.alertState==='object'&&!Array.isArray(snapshot.alertState)?snapshot.alertState:{};
  snapshot.contractTemplates=Array.isArray(snapshot.contractTemplates)?snapshot.contractTemplates:[];
  snapshot.issuedContracts=Array.isArray(snapshot.issuedContracts)?snapshot.issuedContracts:[];
  snapshot.billingPlans=Array.isArray(snapshot.billingPlans)?snapshot.billingPlans:[];
  snapshot.billingInstallments=Array.isArray(snapshot.billingInstallments)?snapshot.billingInstallments:[];
  snapshot.collectionActions=Array.isArray(snapshot.collectionActions)?snapshot.collectionActions:[];
  snapshot.customers=Array.isArray(snapshot.customers)?snapshot.customers.map(customer=>({
    ...customer,
    driverLicense:{number:'',category:'',expiry:'',...(customer.driverLicense??{})}
  })):[];
  snapshot.vehicles=Array.isArray(snapshot.vehicles)?snapshot.vehicles.map(vehicle=>({
    ...vehicle,
    documents:{insuranceExpiry:'',licensingExpiry:'',inspectionExpiry:'',renavam:'',chassis:'',...(vehicle.documents??{})}
  })):[];
  snapshot.updatedAt=snapshot.updatedAt??new Date().toISOString();
  return snapshot;
}

export function nextEntityId(prefix,items=[]){
  const max=items.reduce((acc,item)=>Math.max(acc,Number(String(item?.id??'').replace(/\D/g,''))||0),0);
  return `${prefix}-${String(max+1).padStart(6,'0')}`;
}

export function appendAudit(snapshot,{actorId,action,entityType,entityId,details={}}){
  const audit=Array.isArray(snapshot.audit)?snapshot.audit:[];
  const entry={id:nextEntityId('AUD',audit),at:new Date().toISOString(),actorId,action,entityType,entityId,details};
  snapshot.audit=[entry,...audit];
  snapshot.updatedAt=entry.at;
  return entry;
}

export function updateCustomerLicense(input,customerId,patch={},actorId){
  const snapshot=ensureP1Snapshot(input);const customer=snapshot.customers.find(item=>item.id===customerId);if(!customer)throw new Error('Cliente não encontrado.');
  customer.driverLicense={...customer.driverLicense,...patch};appendAudit(snapshot,{actorId,action:'customer.license_updated',entityType:'customer',entityId:customerId,details:{expiry:customer.driverLicense.expiry||''}});return snapshot;
}

export function updateVehicleDocuments(input,vehicleId,patch={},actorId){
  const snapshot=ensureP1Snapshot(input);const vehicle=snapshot.vehicles.find(item=>item.id===vehicleId);if(!vehicle)throw new Error('Veículo não encontrado.');
  vehicle.documents={...vehicle.documents,...patch};appendAudit(snapshot,{actorId,action:'vehicle.documents_updated',entityType:'vehicle',entityId:vehicleId,details:{...vehicle.documents}});return snapshot;
}
