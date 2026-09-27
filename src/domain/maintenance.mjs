import { appendAudit, ensureP1Snapshot, nextEntityId } from './p1.mjs';

function item(snapshot,id){const found=snapshot.maintenance.find(row=>row.id===id);if(!found)throw new Error('Manutenção não encontrada.');return found;}

export function scheduleMaintenance(input,{vehicleId,type,dueAt='',dueMileage=null,notes='',costEstimate=0}={},actorId){
  const snapshot=ensureP1Snapshot(input);if(!snapshot.vehicles.some(vehicle=>vehicle.id===vehicleId))throw new Error('Veículo não encontrado.');
  if(!String(type??'').trim())throw new Error('Tipo de manutenção é obrigatório.');
  if(!dueAt&&!(Number(dueMileage)>0))throw new Error('Informe data ou quilometragem limite.');
  const now=new Date().toISOString();
  const record={id:nextEntityId('MAN',snapshot.maintenance),vehicleId,type:String(type),dueAt:String(dueAt||''),dueMileage:Number(dueMileage)||null,notes:String(notes),costEstimate:Number(costEstimate)||0,status:'scheduled',createdAt:now,startedAt:null,completedAt:null,cost:0};
  snapshot.maintenance.unshift(record);
  appendAudit(snapshot,{actorId,action:'maintenance.scheduled',entityType:'maintenance',entityId:record.id,details:{vehicleId,type:record.type,dueAt:record.dueAt,dueMileage:record.dueMileage}});
  return snapshot;
}

export function startMaintenance(input,id,actorId){
  const snapshot=ensureP1Snapshot(input);const record=item(snapshot,id);if(record.status==='completed')throw new Error('Manutenção já concluída.');
  record.status='in_progress';record.startedAt=new Date().toISOString();
  const vehicle=snapshot.vehicles.find(row=>row.id===record.vehicleId);if(vehicle)vehicle.availability='manutencao';
  appendAudit(snapshot,{actorId,action:'maintenance.started',entityType:'maintenance',entityId:id,details:{vehicleId:record.vehicleId}});
  return snapshot;
}

export function completeMaintenance(input,id,{cost=0,mileage=null,notes=''}={},actorId){
  const snapshot=ensureP1Snapshot(input);const record=item(snapshot,id);if(record.status==='completed')throw new Error('Manutenção já concluída.');const now=new Date().toISOString();
  record.status='completed';record.completedAt=now;record.cost=Number(cost)||0;if(notes)record.notes=[record.notes,notes].filter(Boolean).join(' | ');
  const vehicle=snapshot.vehicles.find(row=>row.id===record.vehicleId);if(vehicle){const activeRental=snapshot.rentals?.some(r=>r.vehicleId===record.vehicleId&&!r.cancelledAt&&['retirada','em_uso'].includes(r.status));vehicle.availability=activeRental?'locado':'disponivel';if(Number(mileage)>Number(vehicle.mileage||0))vehicle.mileage=Number(mileage);vehicle.updatedAt=now;}
  if(record.cost>0){
    const expense={id:nextEntityId('DES',snapshot.expenses??[]),description:`Manutenção - ${record.type}`,category:'Manutenção',amount:record.cost,dueAt:now,paid:true,vehicleId:record.vehicleId,createdAt:now};
    snapshot.expenses=[expense,...(snapshot.expenses??[])];
    const ledgerEntry={id:nextEntityId('FIN',snapshot.ledger??[]),kind:'expense',expenseId:expense.id,vehicleId:record.vehicleId,description:expense.description,amount:record.cost,paidAmount:record.cost,status:'paid',dueAt:now,createdAt:now,paidAt:now};
    snapshot.ledger=[ledgerEntry,...(snapshot.ledger??[])];
  }
  appendAudit(snapshot,{actorId,action:'maintenance.completed',entityType:'maintenance',entityId:id,details:{cost:record.cost,mileage:Number(mileage)||null}});
  return snapshot;
}

export function maintenanceDue(record,vehicle,now=new Date()){
  if(record.status==='completed')return false;
  const dateDue=record.dueAt&&Number.isFinite(Date.parse(record.dueAt))&&Date.parse(record.dueAt)<=now.getTime();
  const kmDue=Number(record.dueMileage)>0&&Number(vehicle?.mileage||0)>=Number(record.dueMileage);
  return Boolean(dateDue||kmDue);
}

export function syncMaintenanceAvailability(input,now=new Date()){
  const snapshot=ensureP1Snapshot(input);
  for(const vehicle of snapshot.vehicles){
    const blocking=snapshot.maintenance.some(record=>record.vehicleId===vehicle.id&&(record.status==='in_progress'||(record.status==='scheduled'&&maintenanceDue(record,vehicle,now))));
    if(blocking&&vehicle.availability==='disponivel')vehicle.availability='manutencao';
  }
  return snapshot;
}
