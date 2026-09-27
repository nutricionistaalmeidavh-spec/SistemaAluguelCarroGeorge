import { auditStatement } from './audit.mjs';
import { abandonOperation, beginOperationStatement, completeOperationStatement, findOperationReceipt, operationIdentity } from './operation-receipts.mjs';
import { appendChangeStatement } from '../sync/change-log.mjs';

const DAY=86_400_000;
const MAX_DATE='9999-12-31T23:59:59.999Z';
function fail(code,message=code){const error=new Error(message);error.code=code;throw error;}
function round(value){return Math.round((Number(value)+Number.EPSILON)*100)/100;}
function required(value,code){const text=String(value??'').trim();if(!text)fail(code);return text;}
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
  const total=round(period.days*dailyRate),now=new Date().toISOString(),executionId=`EXE-${crypto.randomUUID()}`,rentalId=`LOC-${crypto.randomUUID()}`,ledgerId=`FIN-${crypto.randomUUID()}`,deviceId=auth.deviceId??null;
  const result={id:rentalId,customerId,vehicleId,pickupAt:period.pickupAt,returnAt:period.returnAt,periodMode:period.periodMode,status:'reserva',priority:input.priority??'Media',notes:input.notes??'',dailyRate,days:period.days,total,billingMode:'total',paymentStatus:'aberto',version:1,createdAt:now,updatedAt:now,updatedByDevice:deviceId};
  const receipt=beginOperationStatement(db,{installationId,operationId:op,kind:'rental.create',executionId,createdAt:now});
  const insertRental=db.prepare(`INSERT INTO rentals
    (id, installation_id, vehicle_id, customer_id, attendant_id, pickup_at, return_at, period_mode, status, priority, notes, daily_rate, days, total, billing_mode, payment_status, created_at, updated_at, version, updated_by_device)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'reserva', ?, ?, ?, ?, ?, 'total', 'aberto', ?, ?, 1, ?
    WHERE EXISTS (SELECT 1 FROM operation_receipts WHERE installation_id = ? AND operation_id = ? AND execution_id = ?)
      AND NOT EXISTS (
        SELECT 1 FROM rentals r
        WHERE r.installation_id = ? AND r.vehicle_id = ? AND r.deleted_at IS NULL AND r.status <> 'devolucao'
          AND r.pickup_at < ? AND COALESCE(r.continuous_closed_at, r.return_at, ?) > ?
      )`)
    .bind(rentalId,installationId,vehicleId,customerId,input.attendantId??userId,period.pickupAt,period.returnAt,period.periodMode,result.priority,result.notes,dailyRate,period.days,total,now,now,deviceId,installationId,op,executionId,installationId,vehicleId,period.endForConflict,MAX_DATE,period.pickupAt);
  const insertLedger=db.prepare(`INSERT INTO ledger
    (id, installation_id, kind, billing_purpose, rental_id, vehicle_id, description, amount, paid_amount, status, due_at, created_at, updated_at, version, updated_by_device)
    SELECT ?, ?, 'receivable', 'rental', id, vehicle_id, ?, total, 0, 'open', pickup_at, ?, ?, 1, ? FROM rentals
    WHERE installation_id = ? AND id = ? AND deleted_at IS NULL`)
    .bind(ledgerId,installationId,`Locação ${rentalId}`,now,now,deviceId,installationId,rentalId);
  const change=appendChangeStatement(db,{operationId:op,installationId,deviceId,entityType:'rental',entityId:rentalId,operation:'create',entityVersion:1,payload:result,createdAt:now,guardSql:'EXISTS (SELECT 1 FROM rentals WHERE installation_id = ? AND id = ? AND version = 1 AND deleted_at IS NULL)',guardParams:[installationId,rentalId]});
  const audit=auditStatement(db,{installationId,actorId:userId,action:'rental.created',entityType:'rental',entityId:rentalId,details:{vehicleId,customerId,pickupAt:period.pickupAt,returnAt:period.returnAt,total},deviceId,at:now,guardSql:'EXISTS (SELECT 1 FROM rentals WHERE installation_id = ? AND id = ? AND deleted_at IS NULL)',guardParams:[installationId,rentalId]});
  const complete=completeOperationStatement(db,{installationId,operationId:op,executionId,result,completedAt:now,guardSql:'EXISTS (SELECT 1 FROM rentals WHERE installation_id = ? AND id = ? AND deleted_at IS NULL)',guardParams:[installationId,rentalId]});
  const batch=await db.batch([receipt,insertRental,insertLedger,change,audit,complete]);
  if(Number(batch?.[1]?.meta?.changes??0)!==1||Number(batch?.[3]?.meta?.changes??0)!==1){
    const concurrent=await findOperationReceipt(db,installationId,op);if(concurrent?.result)return{result:concurrent.result,change:null,replayed:true};
    await abandonOperation(db,{installationId,operationId:op,executionId});
    fail('reservation_conflict','Conflito de reserva: o veículo já está comprometido neste período.');
  }
  return{result,change:{entityType:'rental',entityId:rentalId,operation:'create'},replayed:false};
}
