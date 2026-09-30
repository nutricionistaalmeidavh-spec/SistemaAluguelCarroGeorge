import { auditStatement } from './audit.mjs';
import { abandonOperation, beginOperationStatement, completeOperationStatement, findOperationReceipt, operationIdentity } from './operation-receipts.mjs';
import { appendChangeStatement } from '../sync/change-log.mjs';

function fail(code,message=code){const error=new Error(message);error.code=code;throw error;}
function round(value){return Math.round((Number(value)+Number.EPSILON)*100)/100;}
function required(value,code){const text=String(value??'').trim();if(!text)fail(code);return text;}
function entityId(value,prefix){const text=String(value??'').trim();if(text&&/^[A-Za-z0-9._:-]{1,120}$/.test(text))return text;return `${prefix}-${crypto.randomUUID()}`;}

export async function recordRentalPaymentOperation(context,input,operationId){
  const db=context?.db,auth=context?.auth,installationId=auth?.installationId,userId=auth?.userId;
  if(!db?.prepare||!db?.batch||!installationId||!userId)fail('invalid_context');
  const op=operationIdentity(operationId),previous=await findOperationReceipt(db,installationId,op);if(previous?.result)return{result:previous.result,change:null,replayed:true};
  const rentalId=required(input?.rentalId,'rental_required'),method=required(input?.method,'method_required'),amount=round(input?.amount);if(!(amount>0))fail('invalid_amount');
  const rental=await db.prepare(`SELECT r.id, r.total, r.billing_mode, r.version,
      COALESCE((SELECT SUM(p.amount) FROM rental_payments p WHERE p.installation_id = r.installation_id AND p.rental_id = r.id AND p.deleted_at IS NULL),0) AS paid_amount
    FROM rentals r WHERE r.installation_id = ? AND r.id = ? AND r.deleted_at IS NULL LIMIT 1`).bind(installationId,rentalId).first();
  if(!rental)fail('rental_not_found');
  if(rental.billing_mode==='daily'){
    const scheduled=await db.prepare(`SELECT id FROM billing_installments WHERE installation_id = ? AND rental_id = ? AND deleted_at IS NULL AND status <> 'cancelled' LIMIT 1`).bind(installationId,rentalId).first();
    if(scheduled)fail('daily_schedule_required');
  }
  if(amount>round(Number(rental.total)-Number(rental.paid_amount))+0.001)fail('payment_exceeds_balance','Pagamento excede o saldo da locação.');
  const now=new Date().toISOString(),paidAt=input.paidAt??now,executionId=`EXE-${crypto.randomUUID()}`,paymentId=entityId(input?.id,'PAG'),deviceId=auth.deviceId??null;
  const result={id:paymentId,rentalId,amount,method,paidAt};
  const nextPaid=round(Number(rental.paid_amount)+amount),nextRentalStatus=Number(rental.total)<=nextPaid+0.001?'pago':'aberto',nextRentalVersion=Number(rental.version)+1;
  const changePayload={
    payment:{...result,version:1,createdAt:now,updatedAt:now,updatedByDevice:deviceId},
    rental:{id:rentalId,paymentStatus:nextRentalStatus,version:nextRentalVersion,updatedAt:now,updatedByDevice:deviceId}
  };
  const receipt=beginOperationStatement(db,{installationId,operationId:op,kind:'rental.payment',executionId,createdAt:now});
  const payment=db.prepare(`INSERT INTO rental_payments
      (id, installation_id, rental_id, amount, method, paid_at, created_at, updated_at, version, updated_by_device)
    SELECT ?, ?, r.id, ?, ?, ?, ?, ?, 1, ? FROM rentals r
    WHERE r.installation_id = ? AND r.id = ? AND r.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM operation_receipts WHERE installation_id = ? AND operation_id = ? AND execution_id = ? AND result_json IS NULL)
      AND ? <= r.total - COALESCE((SELECT SUM(p.amount) FROM rental_payments p WHERE p.installation_id = r.installation_id AND p.rental_id = r.id AND p.deleted_at IS NULL),0) + 0.001`)
    .bind(paymentId,installationId,amount,method,paidAt,now,now,deviceId,installationId,rentalId,installationId,op,executionId,amount);
  const updateLedger=db.prepare(`UPDATE ledger SET
      paid_amount = (SELECT COALESCE(SUM(p.amount),0) FROM rental_payments p WHERE p.installation_id = ? AND p.rental_id = ? AND p.deleted_at IS NULL),
      status = CASE WHEN amount <= (SELECT COALESCE(SUM(p.amount),0) FROM rental_payments p WHERE p.installation_id = ? AND p.rental_id = ? AND p.deleted_at IS NULL) + 0.001 THEN 'paid' ELSE 'partial' END,
      paid_at = CASE WHEN amount <= (SELECT COALESCE(SUM(p.amount),0) FROM rental_payments p WHERE p.installation_id = ? AND p.rental_id = ? AND p.deleted_at IS NULL) + 0.001 THEN ? ELSE NULL END,
      updated_at = ?, version = version + 1, updated_by_device = ?
    WHERE installation_id = ? AND rental_id = ? AND kind = 'receivable' AND deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM rental_payments WHERE installation_id = ? AND id = ? AND deleted_at IS NULL)`)
    .bind(installationId,rentalId,installationId,rentalId,installationId,rentalId,paidAt,now,deviceId,installationId,rentalId,installationId,paymentId);
  const updateRental=db.prepare(`UPDATE rentals SET
      payment_status = CASE WHEN total <= (SELECT COALESCE(SUM(p.amount),0) FROM rental_payments p WHERE p.installation_id = ? AND p.rental_id = ? AND p.deleted_at IS NULL) + 0.001 THEN 'pago' ELSE 'aberto' END,
      updated_at = ?, version = version + 1, updated_by_device = ?
    WHERE installation_id = ? AND id = ? AND deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM rental_payments WHERE installation_id = ? AND id = ? AND deleted_at IS NULL)`)
    .bind(installationId,rentalId,now,deviceId,installationId,rentalId,installationId,paymentId);
  const change=appendChangeStatement(db,{operationId:op,installationId,deviceId,entityType:'rentalPayment',entityId:paymentId,operation:'create',entityVersion:1,payload:changePayload,createdAt:now,guardSql:'EXISTS (SELECT 1 FROM rental_payments WHERE installation_id = ? AND id = ? AND deleted_at IS NULL)',guardParams:[installationId,paymentId]});
  const audit=auditStatement(db,{installationId,actorId:userId,action:'payment.received',entityType:'rental',entityId:rentalId,details:{paymentId,amount,method},deviceId,at:now,guardSql:'EXISTS (SELECT 1 FROM rental_payments WHERE installation_id = ? AND id = ? AND deleted_at IS NULL)',guardParams:[installationId,paymentId]});
  const complete=completeOperationStatement(db,{installationId,operationId:op,executionId,result,completedAt:now,guardSql:'EXISTS (SELECT 1 FROM rental_payments WHERE installation_id = ? AND id = ? AND deleted_at IS NULL)',guardParams:[installationId,paymentId]});
  const batch=await db.batch([receipt,payment,updateLedger,updateRental,change,audit,complete]);
  if(Number(batch?.[1]?.meta?.changes??0)!==1||Number(batch?.[4]?.meta?.changes??0)!==1){
    const concurrent=await findOperationReceipt(db,installationId,op);if(concurrent?.result)return{result:concurrent.result,change:null,replayed:true};
    await abandonOperation(db,{installationId,operationId:op,executionId});
    fail('payment_exceeds_balance','Pagamento excede o saldo da locação.');
  }
  return{result,change:{entityType:'rentalPayment',entityId:paymentId,operation:'create'},replayed:false};
}

export async function recordInstallmentPaymentOperation(context,input,operationId){
  const db=context?.db,auth=context?.auth,installationId=auth?.installationId,userId=auth?.userId;
  if(!db?.prepare||!db?.batch||!installationId||!userId)fail('invalid_context');
  const op=operationIdentity(operationId),previous=await findOperationReceipt(db,installationId,op);if(previous?.result)return{result:previous.result,change:null,replayed:true};
  const installmentId=required(input?.installmentId,'installment_required'),method=required(input?.method,'method_required'),amount=round(input?.amount);if(!(amount>0))fail('invalid_amount');
  const installment=await db.prepare(`SELECT i.id, i.rental_id, i.amount, i.status, i.version,
      r.total AS rental_total, r.version AS rental_version,
      COALESCE((SELECT SUM(p.amount) FROM billing_payments p WHERE p.installation_id = i.installation_id AND p.installment_id = i.id AND p.deleted_at IS NULL),0) AS paid_amount,
      COALESCE((SELECT SUM(bp.amount) FROM billing_payments bp JOIN billing_installments bi ON bi.id = bp.installment_id AND bi.installation_id = bp.installation_id WHERE bp.installation_id = i.installation_id AND bi.rental_id = i.rental_id AND bp.deleted_at IS NULL AND bi.deleted_at IS NULL AND bi.status <> 'cancelled'),0) AS rental_paid_amount
    FROM billing_installments i JOIN rentals r ON r.installation_id = i.installation_id AND r.id = i.rental_id AND r.deleted_at IS NULL
    WHERE i.installation_id = ? AND i.id = ? AND i.deleted_at IS NULL LIMIT 1`).bind(installationId,installmentId).first();
  if(!installment)fail('installment_not_found');if(installment.status==='cancelled')fail('installment_cancelled');
  if(amount>round(Number(installment.amount)-Number(installment.paid_amount))+0.001)fail('payment_exceeds_balance','Pagamento excede o saldo da parcela.');
  const rentalId=installment.rental_id,now=new Date().toISOString(),paidAt=input.paidAt??now,executionId=`EXE-${crypto.randomUUID()}`,paymentId=entityId(input?.id,'BPG'),deviceId=auth.deviceId??null;
  const result={id:paymentId,installmentId,rentalId,amount,method,paidAt};
  const nextInstallmentPaid=round(Number(installment.paid_amount)+amount),nextInstallmentStatus=Number(installment.amount)<=nextInstallmentPaid+0.001?'paid':'partial';
  const nextRentalPaid=round(Number(installment.rental_paid_amount)+amount),nextRentalStatus=Number(installment.rental_total)<=nextRentalPaid+0.001?'pago':'aberto';
  const changePayload={
    payment:{...result,version:1,createdAt:now,updatedAt:now,updatedByDevice:deviceId},
    installment:{id:installmentId,paidAmount:nextInstallmentPaid,status:nextInstallmentStatus,version:Number(installment.version)+1,updatedAt:now,updatedByDevice:deviceId},
    rental:{id:rentalId,paymentStatus:nextRentalStatus,version:Number(installment.rental_version)+1,updatedAt:now,updatedByDevice:deviceId}
  };
  const receipt=beginOperationStatement(db,{installationId,operationId:op,kind:'installment.payment',executionId,createdAt:now});
  const payment=db.prepare(`INSERT INTO billing_payments
      (id, installation_id, installment_id, amount, method, paid_at, created_at, updated_at, version, updated_by_device)
    SELECT ?, ?, i.id, ?, ?, ?, ?, ?, 1, ? FROM billing_installments i
    WHERE i.installation_id = ? AND i.id = ? AND i.deleted_at IS NULL AND i.status <> 'cancelled'
      AND EXISTS (SELECT 1 FROM operation_receipts WHERE installation_id = ? AND operation_id = ? AND execution_id = ? AND result_json IS NULL)
      AND ? <= i.amount - COALESCE((SELECT SUM(p.amount) FROM billing_payments p WHERE p.installation_id = i.installation_id AND p.installment_id = i.id AND p.deleted_at IS NULL),0) + 0.001`)
    .bind(paymentId,installationId,amount,method,paidAt,now,now,deviceId,installationId,installmentId,installationId,op,executionId,amount);
  const updateInstallment=db.prepare(`UPDATE billing_installments SET
      paid_amount = (SELECT COALESCE(SUM(p.amount),0) FROM billing_payments p WHERE p.installation_id = ? AND p.installment_id = ? AND p.deleted_at IS NULL),
      status = CASE WHEN amount <= (SELECT COALESCE(SUM(p.amount),0) FROM billing_payments p WHERE p.installation_id = ? AND p.installment_id = ? AND p.deleted_at IS NULL) + 0.001 THEN 'paid' ELSE 'partial' END,
      updated_at = ?, version = version + 1, updated_by_device = ?
    WHERE installation_id = ? AND id = ? AND deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM billing_payments WHERE installation_id = ? AND id = ? AND deleted_at IS NULL)`)
    .bind(installationId,installmentId,installationId,installmentId,now,deviceId,installationId,installmentId,installationId,paymentId);
  const updateInstallmentLedger=db.prepare(`UPDATE ledger SET
      paid_amount = (SELECT COALESCE(SUM(p.amount),0) FROM billing_payments p WHERE p.installation_id = ? AND p.installment_id = ? AND p.deleted_at IS NULL),
      status = CASE WHEN amount <= (SELECT COALESCE(SUM(p.amount),0) FROM billing_payments p WHERE p.installation_id = ? AND p.installment_id = ? AND p.deleted_at IS NULL) + 0.001 THEN 'paid' ELSE 'partial' END,
      paid_at = CASE WHEN amount <= (SELECT COALESCE(SUM(p.amount),0) FROM billing_payments p WHERE p.installation_id = ? AND p.installment_id = ? AND p.deleted_at IS NULL) + 0.001 THEN ? ELSE NULL END,
      updated_at = ?, version = version + 1, updated_by_device = ?
    WHERE installation_id = ? AND installment_id = ? AND kind = 'billing_receivable' AND deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM billing_payments WHERE installation_id = ? AND id = ? AND deleted_at IS NULL)`)
    .bind(installationId,installmentId,installationId,installmentId,installationId,installmentId,paidAt,now,deviceId,installationId,installmentId,installationId,paymentId);
  const paidForRental=`SELECT COALESCE(SUM(p.amount),0) FROM billing_payments p JOIN billing_installments i ON i.id = p.installment_id AND i.installation_id = p.installation_id WHERE p.installation_id = ? AND i.rental_id = ? AND p.deleted_at IS NULL AND i.deleted_at IS NULL AND i.status <> 'cancelled'`;
  const updateParentLedger=db.prepare(`UPDATE ledger SET
      paid_amount = (${paidForRental}),
      status = CASE WHEN amount <= (${paidForRental}) + 0.001 THEN 'paid' WHEN (${paidForRental}) > 0 THEN 'partial' ELSE 'open' END,
      paid_at = CASE WHEN amount <= (${paidForRental}) + 0.001 THEN ? ELSE NULL END,
      updated_at = ?, version = version + 1, updated_by_device = ?
    WHERE installation_id = ? AND rental_id = ? AND kind = 'receivable' AND billing_purpose = 'rental' AND deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM billing_payments WHERE installation_id = ? AND id = ? AND deleted_at IS NULL)`)
    .bind(installationId,rentalId,installationId,rentalId,installationId,rentalId,installationId,rentalId,paidAt,now,deviceId,installationId,rentalId,installationId,paymentId);
  const updateRental=db.prepare(`UPDATE rentals SET
      payment_status = CASE WHEN total <= (${paidForRental}) + 0.001 THEN 'pago' ELSE 'aberto' END,
      updated_at = ?, version = version + 1, updated_by_device = ?
    WHERE installation_id = ? AND id = ? AND deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM billing_payments WHERE installation_id = ? AND id = ? AND deleted_at IS NULL)`)
    .bind(installationId,rentalId,now,deviceId,installationId,rentalId,installationId,paymentId);
  const change=appendChangeStatement(db,{operationId:op,installationId,deviceId,entityType:'billingPayment',entityId:paymentId,operation:'create',entityVersion:1,payload:changePayload,createdAt:now,guardSql:'EXISTS (SELECT 1 FROM billing_payments WHERE installation_id = ? AND id = ? AND deleted_at IS NULL)',guardParams:[installationId,paymentId]});
  const audit=auditStatement(db,{installationId,actorId:userId,action:'billing.payment.received',entityType:'billing_installment',entityId:installmentId,details:{paymentId,rentalId,amount,method},deviceId,at:now,guardSql:'EXISTS (SELECT 1 FROM billing_payments WHERE installation_id = ? AND id = ? AND deleted_at IS NULL)',guardParams:[installationId,paymentId]});
  const complete=completeOperationStatement(db,{installationId,operationId:op,executionId,result,completedAt:now,guardSql:'EXISTS (SELECT 1 FROM billing_payments WHERE installation_id = ? AND id = ? AND deleted_at IS NULL)',guardParams:[installationId,paymentId]});
  const batch=await db.batch([receipt,payment,updateInstallment,updateInstallmentLedger,updateParentLedger,updateRental,change,audit,complete]);
  if(Number(batch?.[1]?.meta?.changes??0)!==1||Number(batch?.[6]?.meta?.changes??0)!==1){
    const concurrent=await findOperationReceipt(db,installationId,op);if(concurrent?.result)return{result:concurrent.result,change:null,replayed:true};
    await abandonOperation(db,{installationId,operationId:op,executionId});
    fail('payment_exceeds_balance','Pagamento excede o saldo da parcela.');
  }
  return{result,change:{entityType:'billingPayment',entityId:paymentId,operation:'create'},replayed:false};
}
