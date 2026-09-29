import { auditStatement } from './audit.mjs';
import { abandonOperation, beginOperationStatement, completeOperationStatement, findOperationReceipt, operationIdentity } from './operation-receipts.mjs';
import { appendChangeStatement } from '../sync/change-log.mjs';

const DAY=86_400_000;
function fail(code,message=code){const error=new Error(message);error.code=code;throw error;}
function round(value){return Math.round((Number(value)+Number.EPSILON)*100)/100;}
function required(value,code){const text=String(value??'').trim();if(!text)fail(code);return text;}
function iso(value,code='invalid_date'){const time=new Date(value).getTime();if(!Number.isFinite(time))fail(code);return new Date(time).toISOString();}
function addDays(value,days){return new Date(new Date(value).getTime()+Number(days)*DAY).toISOString();}
function publicRental(row){return row?{
  id:row.id,vehicleId:row.vehicle_id,customerId:row.customer_id,attendantId:row.attendant_id,
  pickupAt:row.pickup_at,returnAt:row.return_at,periodMode:row.period_mode,continuousClosedAt:row.continuous_closed_at,
  status:row.status,priority:row.priority,notes:row.notes,dailyRate:Number(row.daily_rate||0),days:Number(row.days||1),total:Number(row.total||0),
  billingMode:row.billing_mode,paymentStatus:row.payment_status,version:Number(row.version||1),createdAt:row.created_at,updatedAt:row.updated_at,updatedByDevice:row.updated_by_device
}:null;}
async function rentalRow(db,installationId,rentalId){return db.prepare('SELECT * FROM rentals WHERE installation_id=? AND id=? AND deleted_at IS NULL LIMIT 1').bind(installationId,rentalId).first();}
async function completedInspection(db,installationId,rentalId,kind){const row=await db.prepare("SELECT id FROM inspections WHERE installation_id=? AND rental_id=? AND kind=? AND status='completed' AND deleted_at IS NULL LIMIT 1").bind(installationId,rentalId,kind).first();return Boolean(row);}
function contextValues(context){const db=context?.db,auth=context?.auth,installationId=auth?.installationId,userId=auth?.userId;if(!db?.prepare||!db?.batch||!installationId||!userId)fail('invalid_context');return{db,auth,installationId,userId,deviceId:auth.deviceId??null};}

export async function advanceRentalOperation(context,input,operationId){
  const {db,installationId,userId,deviceId}=contextValues(context),op=operationIdentity(operationId),previous=await findOperationReceipt(db,installationId,op);
  if(previous?.result)return{result:previous.result,change:null,replayed:true};
  const rentalId=required(input?.rentalId,'rental_required'),targetStatus=required(input?.status??input?.targetStatus,'status_required'),current=await rentalRow(db,installationId,rentalId);
  if(!current)fail('rental_not_found');
  const allowed={reserva:'retirada',retirada:'em_uso',em_uso:'devolucao'};
  if(allowed[current.status]!==targetStatus)fail('invalid_rental_transition');
  if(targetStatus==='em_uso'&&!(await completedInspection(db,installationId,rentalId,'pickup')))fail('pickup_inspection_required');
  if(targetStatus==='devolucao'){
    if(!(await completedInspection(db,installationId,rentalId,'return')))fail('return_inspection_required');
    if(current.period_mode==='continuous'&&!current.continuous_closed_at)fail('continuous_close_required');
  }
  const now=new Date().toISOString(),executionId=`EXE-${crypto.randomUUID()}`,nextVersion=Number(current.version||1)+1,availability=targetStatus==='devolucao'?'disponivel':'locado';
  const result={...publicRental(current),status:targetStatus,version:nextVersion,updatedAt:now,updatedByDevice:deviceId};
  const statements=[
    beginOperationStatement(db,{installationId,operationId:op,kind:'rental.advance',executionId,createdAt:now}),
    db.prepare(`UPDATE rentals SET status=?, updated_at=?, version=version+1, updated_by_device=? WHERE installation_id=? AND id=? AND status=? AND version=? AND deleted_at IS NULL`).bind(targetStatus,now,deviceId,installationId,rentalId,current.status,Number(current.version||1)),
    db.prepare(`UPDATE vehicles SET availability=?, updated_at=?, version=version+1, updated_by_device=? WHERE installation_id=? AND id=? AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM rentals WHERE installation_id=? AND id=? AND status=? AND updated_at=?)`).bind(availability,now,deviceId,installationId,current.vehicle_id,installationId,rentalId,targetStatus,now),
    appendChangeStatement(db,{operationId:op,installationId,deviceId,entityType:'rental',entityId:rentalId,operation:'update',baseVersion:Number(current.version||1),entityVersion:nextVersion,payload:result,createdAt:now,guardSql:'EXISTS (SELECT 1 FROM rentals WHERE installation_id=? AND id=? AND status=? AND updated_at=?)',guardParams:[installationId,rentalId,targetStatus,now]}),
    auditStatement(db,{installationId,actorId:userId,action:'rental.status_changed',entityType:'rental',entityId:rentalId,details:{from:current.status,status:targetStatus},deviceId,at:now,guardSql:'EXISTS (SELECT 1 FROM rentals WHERE installation_id=? AND id=? AND status=? AND updated_at=?)',guardParams:[installationId,rentalId,targetStatus,now]}),
    completeOperationStatement(db,{installationId,operationId:op,executionId,result,completedAt:now,guardSql:'EXISTS (SELECT 1 FROM rentals WHERE installation_id=? AND id=? AND status=? AND updated_at=?)',guardParams:[installationId,rentalId,targetStatus,now]})
  ];
  const batch=await db.batch(statements);
  if(Number(batch?.[1]?.meta?.changes??0)!==1||Number(batch?.[3]?.meta?.changes??0)!==1){
    const concurrent=await findOperationReceipt(db,installationId,op);if(concurrent?.result)return{result:concurrent.result,change:null,replayed:true};
    await abandonOperation(db,{installationId,operationId:op,executionId});fail('rental_state_conflict');
  }
  return{result,change:{entityType:'rental',entityId:rentalId,operation:'update'},replayed:false};
}

export async function closeContinuousRentalOperation(context,input,operationId){
  const {db,installationId,userId,deviceId}=contextValues(context),op=operationIdentity(operationId),previous=await findOperationReceipt(db,installationId,op);
  if(previous?.result)return{result:previous.result,change:null,replayed:true};
  const rentalId=required(input?.rentalId,'rental_required'),current=await rentalRow(db,installationId,rentalId);if(!current)fail('rental_not_found');
  if(current.period_mode!=='continuous')fail('rental_not_continuous');if(current.continuous_closed_at)fail('continuous_already_closed');
  const returnAt=iso(input?.returnAt??input?.closedAt,'invalid_return_at'),start=new Date(current.pickup_at).getTime(),end=new Date(returnAt).getTime();if(end<=start)fail('invalid_return_at');
  const days=Math.max(1,Math.ceil((end-start)/DAY)),total=round(days*Number(current.daily_rate||0)),plan=await db.prepare("SELECT * FROM billing_plans WHERE installation_id=? AND rental_id=? AND purpose='rental_schedule' AND deleted_at IS NULL LIMIT 1").bind(installationId,rentalId).first();
  if(!plan)fail('billing_plan_not_found');
  const existing=await db.prepare('SELECT sequence FROM billing_installments WHERE installation_id=? AND rental_id=? AND deleted_at IS NULL ORDER BY sequence').bind(installationId,rentalId).all(),existingSequences=new Set((existing?.results??[]).map(row=>Number(row.sequence)));
  const now=new Date().toISOString(),executionId=`EXE-${crypto.randomUUID()}`,nextVersion=Number(current.version||1)+1;
  const result={...publicRental(current),returnAt,continuousClosedAt:returnAt,days,total,version:nextVersion,updatedAt:now,updatedByDevice:deviceId};
  const statements=[
    beginOperationStatement(db,{installationId,operationId:op,kind:'rental.closeContinuous',executionId,createdAt:now}),
    db.prepare(`UPDATE rentals SET return_at=?, continuous_closed_at=?, days=?, total=?, updated_at=?, version=version+1, updated_by_device=? WHERE installation_id=? AND id=? AND period_mode='continuous' AND continuous_closed_at IS NULL AND version=? AND deleted_at IS NULL`).bind(returnAt,returnAt,days,total,now,deviceId,installationId,rentalId,Number(current.version||1)),
    db.prepare(`UPDATE billing_plans SET occurrences=?, generation_closed_at=?, active=0, updated_at=?, version=version+1, updated_by_device=? WHERE installation_id=? AND id=? AND deleted_at IS NULL`).bind(days,returnAt,now,deviceId,installationId,plan.id),
    db.prepare(`UPDATE ledger SET amount=?, updated_at=?, version=version+1, updated_by_device=? WHERE installation_id=? AND rental_id=? AND kind='receivable' AND billing_purpose='rental' AND deleted_at IS NULL`).bind(total,now,deviceId,installationId,rentalId)
  ];
  const generatedIndexes=[];
  for(let sequence=1;sequence<=days;sequence++){
    if(existingSequences.has(sequence))continue;
    const installmentId=`PAR-${crypto.randomUUID()}`,dueAt=addDays(current.pickup_at,sequence-1),installmentIndex=statements.length;
    statements.push(db.prepare(`INSERT INTO billing_installments (id,installation_id,plan_id,rental_id,customer_id,vehicle_id,sequence,due_at,amount,paid_amount,status,fine_percent,interest_monthly_percent,sync_conflict,created_at,updated_at,version,updated_by_device) SELECT ?,?,p.id,p.rental_id,p.customer_id,p.vehicle_id,?,?,p.amount,0,'open',p.fine_percent,p.interest_monthly_percent,0,?,?,1,? FROM billing_plans p WHERE p.installation_id=? AND p.id=? AND p.deleted_at IS NULL`).bind(installmentId,installationId,sequence,dueAt,now,now,deviceId,installationId,plan.id));
    generatedIndexes.push(installmentIndex);
    statements.push(db.prepare(`INSERT INTO ledger (id,installation_id,kind,billing_purpose,rental_id,installment_id,vehicle_id,description,amount,paid_amount,status,due_at,created_at,updated_at,version,updated_by_device) SELECT ?,?,'billing_receivable','rental_schedule',i.rental_id,i.id,i.vehicle_id,?,i.amount,0,'open',i.due_at,?,?,1,? FROM billing_installments i WHERE i.installation_id=? AND i.id=? AND i.deleted_at IS NULL`).bind(`FIN-${crypto.randomUUID()}`,installationId,`Diária ${sequence} da locação ${rentalId}`,now,now,deviceId,installationId,installmentId));
  }
  const changeIndex=statements.length;
  statements.push(appendChangeStatement(db,{operationId:op,installationId,deviceId,entityType:'rental',entityId:rentalId,operation:'update',baseVersion:Number(current.version||1),entityVersion:nextVersion,payload:result,createdAt:now,guardSql:'EXISTS (SELECT 1 FROM rentals WHERE installation_id=? AND id=? AND continuous_closed_at=? AND updated_at=?)',guardParams:[installationId,rentalId,returnAt,now]}));
  statements.push(auditStatement(db,{installationId,actorId:userId,action:'rental.continuous_closed',entityType:'rental',entityId:rentalId,details:{returnAt,days,total},deviceId,at:now,guardSql:'EXISTS (SELECT 1 FROM rentals WHERE installation_id=? AND id=? AND continuous_closed_at=?)',guardParams:[installationId,rentalId,returnAt]}));
  statements.push(completeOperationStatement(db,{installationId,operationId:op,executionId,result,completedAt:now,guardSql:'EXISTS (SELECT 1 FROM rentals WHERE installation_id=? AND id=? AND continuous_closed_at=?)',guardParams:[installationId,rentalId,returnAt]}));
  const batch=await db.batch(statements),badGenerated=generatedIndexes.some(index=>Number(batch?.[index]?.meta?.changes??0)!==1);
  if(Number(batch?.[1]?.meta?.changes??0)!==1||Number(batch?.[2]?.meta?.changes??0)!==1||badGenerated||Number(batch?.[changeIndex]?.meta?.changes??0)!==1){
    const concurrent=await findOperationReceipt(db,installationId,op);if(concurrent?.result)return{result:concurrent.result,change:null,replayed:true};
    await abandonOperation(db,{installationId,operationId:op,executionId});fail('rental_state_conflict');
  }
  return{result,change:{entityType:'rental',entityId:rentalId,operation:'update'},replayed:false};
}
