import { auditStatement } from './audit.mjs';
import { abandonOperation, beginOperationStatement, completeOperationStatement, findOperationReceipt, operationIdentity } from './operation-receipts.mjs';
import { appendChangeStatement } from '../sync/change-log.mjs';

const DAY=86_400_000;
const MAX_DATE='9999-12-31T23:59:59.999Z';
function fail(code,message=code){const error=new Error(message);error.code=code;throw error;}
function round(value){return Math.round((Number(value)+Number.EPSILON)*100)/100;}
function required(value,code){const text=String(value??'').trim();if(!text)fail(code);return text;}
function entityId(value,prefix){const text=String(value??'').trim();if(text&&/^[A-Za-z0-9._:-]{1,120}$/.test(text))return text;return `${prefix}-${crypto.randomUUID()}`;}
function addDaysIso(value,days){const time=new Date(value).getTime();if(!Number.isFinite(time))fail('invalid_period');return new Date(time+(Number(days)||0)*DAY).toISOString();}
function parsePeriod(input){
  const pickupAt=required(input.pickupAt,'pickup_required'),periodMode=input.periodMode==='continuous'?'continuous':'fixed';
  const start=new Date(pickupAt).getTime();if(!Number.isFinite(start))fail('invalid_period');
  if(periodMode==='continuous')return{pickupAt,returnAt:null,periodMode,days:1,endForConflict:MAX_DATE};
  const returnAt=required(input.returnAt,'return_required'),end=new Date(returnAt).getTime();if(!Number.isFinite(end)||end<=start)fail('invalid_period');
  return{pickupAt,returnAt,periodMode,days:Math.max(1,Math.ceil((end-start)/DAY)),endForConflict:returnAt};
}

export async function createRentalOperation(context,input,operationId){
  const db=context?.db,auth=context?.auth,installationId=auth?.installationId,userId=auth?.userId;
  if(!db?.prepare||!db?.batch||!installationId||!userId)fail('invalid_context');
  const op=operationIdentity(operationId),previous=await findOperationReceipt(db,installationId,op);if(previous?.result)return{result:previous.result,change:null,replayed:true};
  const customerId=required(input?.customerId,'customer_required'),vehicleId=required(input?.vehicleId,'vehicle_required');
  const customer=await db.prepare('SELECT id FROM customers WHERE installation_id = ? AND id = ? AND active = 1 AND deleted_at IS NULL LIMIT 1').bind(installationId,customerId).first();
  if(!customer)fail('customer_not_found');
  const vehicle=await db.prepare("SELECT id, availability FROM vehicles WHERE installation_id = ? AND id = ? AND deleted_at IS NULL LIMIT 1").bind(installationId,vehicleId).first();
  if(!vehicle||vehicle.availability==='manutencao')fail('vehicle_unavailable');
  const period=parsePeriod(input),dailyRate=round(input.dailyRate);if(!(dailyRate>0))fail('invalid_daily_rate');
  const billingMode=input?.billingMode==='daily'?'daily':'total';if(period.periodMode==='continuous'&&billingMode!=='daily')fail('daily_schedule_required');
  const total=round(period.days*dailyRate),now=new Date().toISOString(),executionId=`EXE-${crypto.randomUUID()}`,rentalId=entityId(input?.id,'LOC'),ledgerId=`FIN-${crypto.randomUUID()}`,deviceId=auth.deviceId??null;
  const planId=billingMode==='daily'?`COB-${crypto.randomUUID()}`:null,installmentIds=billingMode==='daily'?Array.from({length:period.days},()=>`PAR-${crypto.randomUUID()}`):[];
  const result={id:rentalId,customerId,vehicleId,pickupAt:period.pickupAt,returnAt:period.returnAt,periodMode:period.periodMode,status:'reserva',priority:input.priority??'Media',notes:input.notes??'',dailyRate,days:period.days,total,billingMode,paymentStatus:'aberto',billingPlanId:planId,installmentIds,version:1,createdAt:now,updatedAt:now,updatedByDevice:deviceId};
  const receipt=beginOperationStatement(db,{installationId,operationId:op,kind:'rental.create',executionId,createdAt:now});
  const insertRental=db.prepare(`INSERT INTO rentals
    (id, installation_id, vehicle_id, customer_id, attendant_id, pickup_at, return_at, period_mode, status, priority, notes, daily_rate, days, total, billing_mode, payment_status, created_at, updated_at, version, updated_by_device)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'reserva', ?, ?, ?, ?, ?, ?, 'aberto', ?, ?, 1, ?
    WHERE EXISTS (SELECT 1 FROM operation_receipts WHERE installation_id = ? AND operation_id = ? AND execution_id = ?)
      AND NOT EXISTS (
        SELECT 1 FROM rentals r
        WHERE r.installation_id = ? AND r.vehicle_id = ? AND r.deleted_at IS NULL AND r.status <> 'devolucao'
          AND r.pickup_at < ? AND COALESCE(r.continuous_closed_at, r.return_at, ?) > ?
      )`)
    .bind(rentalId,installationId,vehicleId,customerId,input.attendantId??userId,period.pickupAt,period.returnAt,period.periodMode,result.priority,result.notes,dailyRate,period.days,total,billingMode,now,now,deviceId,installationId,op,executionId,installationId,vehicleId,period.endForConflict,MAX_DATE,period.pickupAt);
  const insertLedger=db.prepare(`INSERT INTO ledger
    (id, installation_id, kind, billing_purpose, rental_id, vehicle_id, description, amount, paid_amount, status, due_at, created_at, updated_at, version, updated_by_device)
    SELECT ?, ?, 'receivable', 'rental', id, vehicle_id, ?, total, 0, 'open', pickup_at, ?, ?, 1, ? FROM rentals
    WHERE installation_id = ? AND id = ? AND deleted_at IS NULL`)
    .bind(ledgerId,installationId,`Locação ${rentalId}`,now,now,deviceId,installationId,rentalId);
  const statements=[receipt,insertRental,insertLedger],requiredIndexes=[1,2];
  if(billingMode==='daily'){
    const planIndex=statements.length;
    statements.push(db.prepare(`INSERT INTO billing_plans
      (id, installation_id, rental_id, customer_id, vehicle_id, purpose, frequency, custom_days, amount, occurrences, first_due_at, fine_percent, interest_monthly_percent, active, generation_mode, generation_closed_at, created_at, updated_at, version, updated_by_device)
      SELECT ?, ?, r.id, r.customer_id, r.vehicle_id, 'rental_schedule', 'daily', NULL, r.daily_rate, r.days, r.pickup_at, 0, 0, 1, ?, NULL, ?, ?, 1, ? FROM rentals r
      WHERE r.installation_id = ? AND r.id = ? AND r.deleted_at IS NULL`)
      .bind(planId,installationId,period.periodMode==='continuous'?'continuous':'fixed',now,now,deviceId,installationId,rentalId));
    requiredIndexes.push(planIndex);
    for(let index=0;index<period.days;index++){
      const installmentId=installmentIds[index],dueAt=addDaysIso(period.pickupAt,index),installmentIndex=statements.length;
      statements.push(db.prepare(`INSERT INTO billing_installments
        (id, installation_id, plan_id, rental_id, customer_id, vehicle_id, sequence, due_at, amount, paid_amount, status, fine_percent, interest_monthly_percent, sync_conflict, created_at, updated_at, version, updated_by_device)
        SELECT ?, ?, p.id, p.rental_id, p.customer_id, p.vehicle_id, ?, ?, p.amount, 0, 'open', p.fine_percent, p.interest_monthly_percent, 0, ?, ?, 1, ? FROM billing_plans p
        WHERE p.installation_id = ? AND p.id = ? AND p.deleted_at IS NULL`)
        .bind(installmentId,installationId,index+1,dueAt,now,now,deviceId,installationId,planId));
      requiredIndexes.push(installmentIndex);
      const installmentLedgerIndex=statements.length;
      statements.push(db.prepare(`INSERT INTO ledger
        (id, installation_id, kind, billing_purpose, rental_id, installment_id, vehicle_id, description, amount, paid_amount, status, due_at, created_at, updated_at, version, updated_by_device)
        SELECT ?, ?, 'billing_receivable', 'rental_schedule', i.rental_id, i.id, i.vehicle_id, ?, i.amount, 0, 'open', i.due_at, ?, ?, 1, ? FROM billing_installments i
        WHERE i.installation_id = ? AND i.id = ? AND i.deleted_at IS NULL`)
        .bind(`FIN-${crypto.randomUUID()}`,installationId,`Diária ${index+1} da locação ${rentalId}`,now,now,deviceId,installationId,installmentId));
      requiredIndexes.push(installmentLedgerIndex);
    }
  }
  const changeIndex=statements.length;
  statements.push(appendChangeStatement(db,{operationId:op,installationId,deviceId,entityType:'rental',entityId:rentalId,operation:'create',entityVersion:1,payload:result,createdAt:now,guardSql:'EXISTS (SELECT 1 FROM rentals WHERE installation_id = ? AND id = ? AND version = 1 AND deleted_at IS NULL)',guardParams:[installationId,rentalId]}));
  statements.push(auditStatement(db,{installationId,actorId:userId,action:'rental.created',entityType:'rental',entityId:rentalId,details:{vehicleId,customerId,pickupAt:period.pickupAt,returnAt:period.returnAt,total,billingMode},deviceId,at:now,guardSql:'EXISTS (SELECT 1 FROM rentals WHERE installation_id = ? AND id = ? AND deleted_at IS NULL)',guardParams:[installationId,rentalId]}));
  statements.push(completeOperationStatement(db,{installationId,operationId:op,executionId,result,completedAt:now,guardSql:'EXISTS (SELECT 1 FROM rentals WHERE installation_id = ? AND id = ? AND deleted_at IS NULL)',guardParams:[installationId,rentalId]}));
  const batch=await db.batch(statements);
  const missingCritical=requiredIndexes.some(index=>Number(batch?.[index]?.meta?.changes??0)!==1);
  if(missingCritical||Number(batch?.[changeIndex]?.meta?.changes??0)!==1){
    const concurrent=await findOperationReceipt(db,installationId,op);if(concurrent?.result)return{result:concurrent.result,change:null,replayed:true};
    await abandonOperation(db,{installationId,operationId:op,executionId});
    fail('reservation_conflict','Conflito de reserva: o veículo já está comprometido neste período.');
  }
  return{result,change:{entityType:'rental',entityId:rentalId,operation:'create'},replayed:false};
}

export async function advanceRentalOperation(context,input,operationId){
  const db=context?.db,auth=context?.auth,installationId=auth?.installationId,userId=auth?.userId;if(!db?.prepare||!db?.batch||!installationId||!userId)fail('invalid_context');
  const op=operationIdentity(operationId),previous=await findOperationReceipt(db,installationId,op);if(previous?.result)return{result:previous.result,change:null,replayed:true};
  const rentalId=required(input?.rentalId,'rental_required'),requested=required(input?.status,'status_required'),rental=await db.prepare('SELECT * FROM rentals WHERE installation_id=? AND id=? AND deleted_at IS NULL LIMIT 1').bind(installationId,rentalId).first();if(!rental)fail('rental_not_found');
  const allowed={reserva:'retirada',retirada:'em_uso',em_uso:'devolucao'};if(allowed[rental.status]!==requested)fail('invalid_rental_transition');
  if(requested==='em_uso'){
    const inspection=await db.prepare("SELECT id FROM inspections WHERE installation_id=? AND rental_id=? AND kind='pickup' AND status='completed' AND deleted_at IS NULL LIMIT 1").bind(installationId,rentalId).first();if(!inspection)fail('pickup_inspection_required');
  }
  if(requested==='devolucao'){
    const inspection=await db.prepare("SELECT id FROM inspections WHERE installation_id=? AND rental_id=? AND kind='return' AND status='completed' AND deleted_at IS NULL LIMIT 1").bind(installationId,rentalId).first();if(!inspection)fail('return_inspection_required');
    if(rental.period_mode==='continuous'&&!rental.continuous_closed_at)fail('continuous_rental_open');
  }
  const now=new Date().toISOString(),executionId=`EXE-${crypto.randomUUID()}`,deviceId=auth.deviceId??null,nextVersion=Number(rental.version||1)+1;
  const result={id:rentalId,customerId:rental.customer_id,vehicleId:rental.vehicle_id,pickupAt:rental.pickup_at,returnAt:rental.return_at,periodMode:rental.period_mode,continuousClosedAt:rental.continuous_closed_at,status:requested,priority:rental.priority,notes:rental.notes,dailyRate:Number(rental.daily_rate||0),days:Number(rental.days||1),total:Number(rental.total||0),billingMode:rental.billing_mode,paymentStatus:rental.payment_status,version:nextVersion,updatedAt:now,updatedByDevice:deviceId};
  const receipt=beginOperationStatement(db,{installationId,operationId:op,kind:'rental.advance',executionId,createdAt:now});
  const update=db.prepare(`UPDATE rentals SET status=?,updated_at=?,version=version+1,updated_by_device=? WHERE installation_id=? AND id=? AND status=? AND version=? AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM operation_receipts WHERE installation_id=? AND operation_id=? AND execution_id=? AND result_json IS NULL)`).bind(requested,now,deviceId,installationId,rentalId,rental.status,Number(rental.version||1),installationId,op,executionId);
  const vehicle=db.prepare(`UPDATE vehicles SET availability=CASE WHEN ?='devolucao' THEN CASE WHEN EXISTS(SELECT 1 FROM maintenance m WHERE m.installation_id=? AND m.vehicle_id=vehicles.id AND m.deleted_at IS NULL AND m.status IN ('scheduled','in_progress')) THEN 'manutencao' ELSE 'disponivel' END ELSE 'locado' END,updated_at=?,version=version+1,updated_by_device=? WHERE installation_id=? AND id=? AND deleted_at IS NULL AND EXISTS(SELECT 1 FROM rentals r WHERE r.installation_id=? AND r.id=? AND r.status=?)`).bind(requested,installationId,now,deviceId,installationId,rental.vehicle_id,installationId,rentalId,requested);
  const change=appendChangeStatement(db,{operationId:op,installationId,deviceId,entityType:'rental',entityId:rentalId,operation:'update',baseVersion:Number(rental.version||1),entityVersion:nextVersion,payload:result,createdAt:now,guardSql:'EXISTS (SELECT 1 FROM rentals WHERE installation_id=? AND id=? AND status=? AND version=?)',guardParams:[installationId,rentalId,requested,nextVersion]});
  const audit=auditStatement(db,{installationId,actorId:userId,action:'rental.status_changed',entityType:'rental',entityId:rentalId,details:{from:rental.status,to:requested},deviceId,at:now,guardSql:'EXISTS (SELECT 1 FROM rentals WHERE installation_id=? AND id=? AND status=?)',guardParams:[installationId,rentalId,requested]});
  const complete=completeOperationStatement(db,{installationId,operationId:op,executionId,result,completedAt:now,guardSql:'EXISTS (SELECT 1 FROM rentals WHERE installation_id=? AND id=? AND status=? AND version=?)',guardParams:[installationId,rentalId,requested,nextVersion]});
  const batch=await db.batch([receipt,update,vehicle,change,audit,complete]);if(Number(batch?.[1]?.meta?.changes??0)!==1||Number(batch?.[3]?.meta?.changes??0)!==1){const concurrent=await findOperationReceipt(db,installationId,op);if(concurrent?.result)return{result:concurrent.result,change:null,replayed:true};await abandonOperation(db,{installationId,operationId:op,executionId});fail('rental_state_conflict');}
  return{result,change:{entityType:'rental',entityId:rentalId,operation:'update'},replayed:false};
}

export async function closeContinuousRentalOperation(context,input,operationId){
  const db=context?.db,auth=context?.auth,installationId=auth?.installationId,userId=auth?.userId;if(!db?.prepare||!db?.batch||!installationId||!userId)fail('invalid_context');
  const op=operationIdentity(operationId),previous=await findOperationReceipt(db,installationId,op);if(previous?.result)return{result:previous.result,change:null,replayed:true};
  const rentalId=required(input?.rentalId,'rental_required'),returnAt=required(input?.returnAt,'return_required'),closedTime=new Date(returnAt).getTime(),rental=await db.prepare('SELECT * FROM rentals WHERE installation_id=? AND id=? AND deleted_at IS NULL LIMIT 1').bind(installationId,rentalId).first();if(!rental)fail('rental_not_found');
  if(rental.period_mode!=='continuous'||rental.continuous_closed_at)fail('continuous_rental_closed');if(rental.status!=='em_uso')fail('continuous_rental_not_in_use');const pickupTime=new Date(rental.pickup_at).getTime();if(!Number.isFinite(closedTime)||!Number.isFinite(pickupTime)||closedTime<=pickupTime)fail('invalid_period');
  const plan=await db.prepare("SELECT * FROM billing_plans WHERE installation_id=? AND rental_id=? AND purpose='rental_schedule' AND frequency='daily' AND active=1 AND deleted_at IS NULL LIMIT 1").bind(installationId,rentalId).first();if(!plan)fail('daily_schedule_required');
  const existingResult=await db.prepare("SELECT COALESCE(MAX(sequence),0) AS n FROM billing_installments WHERE installation_id=? AND plan_id=? AND deleted_at IS NULL AND status<>'cancelled'").bind(installationId,plan.id).first(),existing=Math.max(0,Number(existingResult?.n)||0),days=Math.max(1,Math.ceil((closedTime-pickupTime)/DAY)),total=round(days*Number(plan.amount||rental.daily_rate||0)),now=new Date().toISOString(),executionId=`EXE-${crypto.randomUUID()}`,deviceId=auth.deviceId??null,nextVersion=Number(rental.version||1)+1;
  const result={id:rentalId,customerId:rental.customer_id,vehicleId:rental.vehicle_id,pickupAt:rental.pickup_at,returnAt:new Date(closedTime).toISOString(),periodMode:'continuous',continuousClosedAt:new Date(closedTime).toISOString(),status:rental.status,priority:rental.priority,notes:rental.notes,dailyRate:Number(rental.daily_rate||0),days,total,billingMode:rental.billing_mode,paymentStatus:rental.payment_status,version:nextVersion,updatedAt:now,updatedByDevice:deviceId};
  const statements=[beginOperationStatement(db,{installationId,operationId:op,kind:'rental.closeContinuous',executionId,createdAt:now})],requiredIndexes=[];
  for(let sequence=existing+1;sequence<=days;sequence++){
    const installmentId=`PAR-${crypto.randomUUID()}`,dueAt=addDaysIso(rental.pickup_at,sequence-1),installIndex=statements.length;statements.push(db.prepare(`INSERT INTO billing_installments(id,installation_id,plan_id,rental_id,customer_id,vehicle_id,sequence,due_at,amount,paid_amount,status,fine_percent,interest_monthly_percent,sync_conflict,created_at,updated_at,version,updated_by_device) VALUES(?,?,?,?,?,?,?,?,?,0,'open',?,?,0,?,?,1,?)`).bind(installmentId,installationId,plan.id,rentalId,rental.customer_id,rental.vehicle_id,sequence,dueAt,Number(plan.amount||0),Number(plan.fine_percent||0),Number(plan.interest_monthly_percent||0),now,now,deviceId));requiredIndexes.push(installIndex);
    const ledgerIndex=statements.length;statements.push(db.prepare(`INSERT INTO ledger(id,installation_id,kind,billing_purpose,rental_id,installment_id,vehicle_id,description,amount,paid_amount,status,due_at,created_at,updated_at,version,updated_by_device) VALUES(?,?,'billing_receivable','rental_schedule',?,?,?,?,?,0,'open',?,?,?,1,?)`).bind(`FIN-${crypto.randomUUID()}`,installationId,rentalId,installmentId,rental.vehicle_id,`Diária ${sequence} da locação ${rentalId}`,Number(plan.amount||0),dueAt,now,now,deviceId));requiredIndexes.push(ledgerIndex);
  }
  const rentalUpdateIndex=statements.length;statements.push(db.prepare(`UPDATE rentals SET return_at=?,continuous_closed_at=?,days=?,total=?,updated_at=?,version=version+1,updated_by_device=? WHERE installation_id=? AND id=? AND period_mode='continuous' AND continuous_closed_at IS NULL AND status='em_uso' AND version=?`).bind(result.returnAt,result.continuousClosedAt,days,total,now,deviceId,installationId,rentalId,Number(rental.version||1)));requiredIndexes.push(rentalUpdateIndex);
  const planUpdateIndex=statements.length;statements.push(db.prepare(`UPDATE billing_plans SET occurrences=?,generation_closed_at=?,updated_at=?,version=version+1,updated_by_device=? WHERE installation_id=? AND id=? AND generation_closed_at IS NULL AND deleted_at IS NULL`).bind(days,result.continuousClosedAt,now,deviceId,installationId,plan.id));requiredIndexes.push(planUpdateIndex);
  statements.push(db.prepare(`UPDATE ledger SET amount=?,updated_at=?,version=version+1,updated_by_device=? WHERE installation_id=? AND rental_id=? AND kind='receivable' AND billing_purpose='rental' AND deleted_at IS NULL`).bind(total,now,deviceId,installationId,rentalId));
  const changeIndex=statements.length;statements.push(appendChangeStatement(db,{operationId:op,installationId,deviceId,entityType:'rental',entityId:rentalId,operation:'update',baseVersion:Number(rental.version||1),entityVersion:nextVersion,payload:result,createdAt:now,guardSql:'EXISTS (SELECT 1 FROM rentals WHERE installation_id=? AND id=? AND continuous_closed_at=? AND version=?)',guardParams:[installationId,rentalId,result.continuousClosedAt,nextVersion]}));
  statements.push(auditStatement(db,{installationId,actorId:userId,action:'daily_schedule.closed',entityType:'rental',entityId:rentalId,details:{returnAt:result.returnAt,days,total},deviceId,at:now,guardSql:'EXISTS (SELECT 1 FROM rentals WHERE installation_id=? AND id=? AND continuous_closed_at=?)',guardParams:[installationId,rentalId,result.continuousClosedAt]}));
  statements.push(completeOperationStatement(db,{installationId,operationId:op,executionId,result,completedAt:now,guardSql:'EXISTS (SELECT 1 FROM rentals WHERE installation_id=? AND id=? AND continuous_closed_at=? AND version=?)',guardParams:[installationId,rentalId,result.continuousClosedAt,nextVersion]}));
  const batch=await db.batch(statements),failed=requiredIndexes.some(index=>Number(batch?.[index]?.meta?.changes??0)!==1);if(failed||Number(batch?.[changeIndex]?.meta?.changes??0)!==1){const concurrent=await findOperationReceipt(db,installationId,op);if(concurrent?.result)return{result:concurrent.result,change:null,replayed:true};await abandonOperation(db,{installationId,operationId:op,executionId});fail('rental_state_conflict');}
  return{result,change:{entityType:'rental',entityId:rentalId,operation:'update'},replayed:false};
}
