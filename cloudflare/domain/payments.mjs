import { auditStatement } from './audit.mjs';
import { abandonOperation, beginOperationStatement, completeOperationStatement, findOperationReceipt, operationIdentity } from './operation-receipts.mjs';

function fail(code,message=code){const error=new Error(message);error.code=code;throw error;}
function round(value){return Math.round((Number(value)+Number.EPSILON)*100)/100;}
function required(value,code){const text=String(value??'').trim();if(!text)fail(code);return text;}

export async function recordRentalPaymentOperation(context,input,operationId){
  const db=context?.db,auth=context?.auth,installationId=auth?.installationId,userId=auth?.userId;
  if(!db?.prepare||!db?.batch||!installationId||!userId)fail('invalid_context');
  const op=operationIdentity(operationId),previous=await findOperationReceipt(db,installationId,op);if(previous?.result)return{result:previous.result,change:null,replayed:true};
  const rentalId=required(input?.rentalId,'rental_required'),method=required(input?.method,'method_required'),amount=round(input?.amount);if(!(amount>0))fail('invalid_amount');
  const rental=await db.prepare(`SELECT r.id, r.total, r.billing_mode,
      COALESCE((SELECT SUM(p.amount) FROM rental_payments p WHERE p.installation_id = r.installation_id AND p.rental_id = r.id AND p.deleted_at IS NULL),0) AS paid_amount
    FROM rentals r WHERE r.installation_id = ? AND r.id = ? AND r.deleted_at IS NULL LIMIT 1`).bind(installationId,rentalId).first();
  if(!rental)fail('rental_not_found');if(rental.billing_mode==='daily')fail('daily_schedule_required');
  if(amount>round(Number(rental.total)-Number(rental.paid_amount))+0.001)fail('payment_exceeds_balance','Pagamento excede o saldo da locação.');
  const now=new Date().toISOString(),paidAt=input.paidAt??now,executionId=`EXE-${crypto.randomUUID()}`,paymentId=`PAG-${crypto.randomUUID()}`;
  const result={id:paymentId,rentalId,amount,method,paidAt};
  const receipt=beginOperationStatement(db,{installationId,operationId:op,kind:'rental.payment',executionId,createdAt:now});
  const payment=db.prepare(`INSERT INTO rental_payments
      (id, installation_id, rental_id, amount, method, paid_at, created_at, updated_at, version, updated_by_device)
    SELECT ?, ?, r.id, ?, ?, ?, ?, ?, 1, ? FROM rentals r
    WHERE r.installation_id = ? AND r.id = ? AND r.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM operation_receipts WHERE installation_id = ? AND operation_id = ? AND execution_id = ? AND result_json IS NULL)
      AND ? <= r.total - COALESCE((SELECT SUM(p.amount) FROM rental_payments p WHERE p.installation_id = r.installation_id AND p.rental_id = r.id AND p.deleted_at IS NULL),0) + 0.001`)
    .bind(paymentId,installationId,amount,method,paidAt,now,now,auth.deviceId??null,installationId,rentalId,installationId,op,executionId,amount);
  const updateLedger=db.prepare(`UPDATE ledger SET
      paid_amount = (SELECT COALESCE(SUM(p.amount),0) FROM rental_payments p WHERE p.installation_id = ? AND p.rental_id = ? AND p.deleted_at IS NULL),
      status = CASE WHEN amount <= (SELECT COALESCE(SUM(p.amount),0) FROM rental_payments p WHERE p.installation_id = ? AND p.rental_id = ? AND p.deleted_at IS NULL) + 0.001 THEN 'paid' ELSE 'partial' END,
      paid_at = CASE WHEN amount <= (SELECT COALESCE(SUM(p.amount),0) FROM rental_payments p WHERE p.installation_id = ? AND p.rental_id = ? AND p.deleted_at IS NULL) + 0.001 THEN ? ELSE NULL END,
      updated_at = ?, version = version + 1, updated_by_device = ?
    WHERE installation_id = ? AND rental_id = ? AND kind = 'receivable' AND deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM rental_payments WHERE installation_id = ? AND id = ? AND deleted_at IS NULL)`)
    .bind(installationId,rentalId,installationId,rentalId,installationId,rentalId,paidAt,now,auth.deviceId??null,installationId,rentalId,installationId,paymentId);
  const updateRental=db.prepare(`UPDATE rentals SET
      payment_status = CASE WHEN total <= (SELECT COALESCE(SUM(p.amount),0) FROM rental_payments p WHERE p.installation_id = ? AND p.rental_id = ? AND p.deleted_at IS NULL) + 0.001 THEN 'pago' ELSE 'aberto' END,
      updated_at = ?, version = version + 1, updated_by_device = ?
    WHERE installation_id = ? AND id = ? AND deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM rental_payments WHERE installation_id = ? AND id = ? AND deleted_at IS NULL)`)
    .bind(installationId,rentalId,now,auth.deviceId??null,installationId,rentalId,installationId,paymentId);
  const audit=auditStatement(db,{installationId,actorId:userId,action:'payment.received',entityType:'rental',entityId:rentalId,details:{paymentId,amount,method},deviceId:auth.deviceId??null,at:now,guardSql:'EXISTS (SELECT 1 FROM rental_payments WHERE installation_id = ? AND id = ? AND deleted_at IS NULL)',guardParams:[installationId,paymentId]});
  const complete=completeOperationStatement(db,{installationId,operationId:op,executionId,result,completedAt:now,guardSql:'EXISTS (SELECT 1 FROM rental_payments WHERE installation_id = ? AND id = ? AND deleted_at IS NULL)',guardParams:[installationId,paymentId]});
  const batch=await db.batch([receipt,payment,updateLedger,updateRental,audit,complete]);
  if(Number(batch?.[1]?.meta?.changes??0)!==1){
    const concurrent=await findOperationReceipt(db,installationId,op);if(concurrent?.result)return{result:concurrent.result,change:null,replayed:true};
    await abandonOperation(db,{installationId,operationId:op,executionId});
    fail('payment_exceeds_balance','Pagamento excede o saldo da locação.');
  }
  return{result,change:{entityType:'rental_payment',entityId:paymentId,operation:'create'},replayed:false};
}
