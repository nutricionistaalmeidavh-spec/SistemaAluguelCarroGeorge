import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeD1, seedOperationFixture } from './helpers/fake-d1.mjs';
import { recordInstallmentPaymentOperation } from '../cloudflare/domain/payments.mjs';

function setup(){
  const db=new FakeD1(),ids=seedOperationFixture(db),now='2026-09-27T12:00:00.000Z',rentalId='LOC-DAILY',planId='PLAN-DAILY';
  db.sqlite.prepare(`INSERT INTO rentals
    (id,installation_id,vehicle_id,customer_id,attendant_id,pickup_at,return_at,period_mode,status,daily_rate,days,total,billing_mode,payment_status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(rentalId,ids.installationId,ids.vehicleId,ids.customerId,ids.userId,'2026-10-01T10:00:00.000Z','2026-10-03T10:00:00.000Z','fixed','em_uso',80,2,160,'daily','aberto',now,now);
  db.sqlite.prepare(`INSERT INTO billing_plans
    (id,installation_id,rental_id,customer_id,vehicle_id,purpose,frequency,amount,occurrences,first_due_at,active,created_at,updated_at)
    VALUES (?,?,?,?,?,'rental_schedule','daily',80,2,'2026-10-01',1,?,?)`)
    .run(planId,ids.installationId,rentalId,ids.customerId,ids.vehicleId,now,now);
  for(const [sequence,id,due] of [[1,'PAR-1','2026-10-01'],[2,'PAR-2','2026-10-02']]){
    db.sqlite.prepare(`INSERT INTO billing_installments
      (id,installation_id,plan_id,rental_id,customer_id,vehicle_id,sequence,due_at,amount,paid_amount,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,80,0,'open',?,?)`)
      .run(id,ids.installationId,planId,rentalId,ids.customerId,ids.vehicleId,sequence,due,now,now);
    db.sqlite.prepare(`INSERT INTO ledger
      (id,installation_id,kind,billing_purpose,rental_id,installment_id,vehicle_id,description,amount,paid_amount,status,due_at,created_at,updated_at)
      VALUES (?,?, 'billing_receivable','rental_schedule',?,?,?,?,80,0,'open',?,?,?)`)
      .run(`FIN-${id}`,ids.installationId,rentalId,id,ids.vehicleId,`Diária ${sequence}`,due,now,now);
  }
  db.sqlite.prepare(`INSERT INTO ledger
    (id,installation_id,kind,billing_purpose,rental_id,vehicle_id,description,amount,paid_amount,status,due_at,created_at,updated_at)
    VALUES ('FIN-PARENT',?,'receivable','rental',?,?, 'Locação diária',160,0,'open','2026-10-01',?,?)`)
    .run(ids.installationId,rentalId,ids.vehicleId,now,now);
  return{db,...ids,rentalId,auth:{installationId:ids.installationId,userId:ids.userId,deviceId:'DEV-BILL',role:'admin',active:true}};
}

test('pagamento parcial de diária reconcilia parcela e recebível pai sem dupla receita',async()=>{
  const ctx=setup();
  try{
    const first=await recordInstallmentPaymentOperation({db:ctx.db,auth:ctx.auth},{installmentId:'PAR-1',amount:30,method:'pix',paidAt:'2026-10-01T12:00:00.000Z'},'OP-INST-30');
    assert.equal(first.result.amount,30);
    assert.equal(ctx.db.scalar("SELECT paid_amount FROM billing_installments WHERE id='PAR-1'"),30);
    assert.equal(ctx.db.scalar("SELECT status FROM billing_installments WHERE id='PAR-1'"),'partial');
    assert.equal(ctx.db.scalar("SELECT paid_amount FROM ledger WHERE id='FIN-PAR-1'"),30);
    assert.equal(ctx.db.scalar("SELECT paid_amount FROM ledger WHERE id='FIN-PARENT'"),30);
    assert.equal(ctx.db.scalar("SELECT payment_status FROM rentals WHERE id=?",ctx.rentalId),'aberto');

    await recordInstallmentPaymentOperation({db:ctx.db,auth:ctx.auth},{installmentId:'PAR-1',amount:50,method:'pix',paidAt:'2026-10-01T13:00:00.000Z'},'OP-INST-50');
    assert.equal(ctx.db.scalar("SELECT paid_amount FROM billing_installments WHERE id='PAR-1'"),80);
    assert.equal(ctx.db.scalar("SELECT status FROM billing_installments WHERE id='PAR-1'"),'paid');
    assert.equal(ctx.db.scalar("SELECT paid_amount FROM ledger WHERE id='FIN-PARENT'"),80);
    assert.equal(ctx.db.scalar("SELECT COUNT(*) FROM billing_payments WHERE installment_id='PAR-1'"),2);
    assert.equal(ctx.db.scalar("SELECT COUNT(*) FROM rental_payments WHERE rental_id=?",ctx.rentalId),0);
    assert.equal(ctx.db.scalar("SELECT COUNT(*) FROM sync_changes WHERE installation_id=? AND operation_id='OP-INST-30' AND entity_type='billingPayment'",ctx.installationId),1);
    assert.equal(ctx.db.scalar("SELECT COUNT(*) FROM sync_changes WHERE installation_id=? AND operation_id='OP-INST-50' AND entity_type='billingPayment'",ctx.installationId),1);
  }finally{ctx.db.close();}
});

test('retry de pagamento de parcela usa o mesmo recibo idempotente',async()=>{
  const ctx=setup();
  try{
    const input={installmentId:'PAR-2',amount:25,method:'dinheiro'};
    const a=await recordInstallmentPaymentOperation({db:ctx.db,auth:ctx.auth},input,'OP-INST-RETRY');
    const b=await recordInstallmentPaymentOperation({db:ctx.db,auth:ctx.auth},input,'OP-INST-RETRY');
    assert.equal(a.result.id,b.result.id);
    assert.equal(ctx.db.scalar("SELECT COUNT(*) FROM billing_payments WHERE installment_id='PAR-2'"),1);
    assert.equal(ctx.db.scalar("SELECT paid_amount FROM billing_installments WHERE id='PAR-2'"),25);
    assert.equal(ctx.db.scalar("SELECT COUNT(*) FROM sync_changes WHERE installation_id=? AND operation_id='OP-INST-RETRY'",ctx.installationId),1);
  }finally{ctx.db.close();}
});

test('pagamento de parcela acima do saldo falha sem mutação',async()=>{
  const ctx=setup();
  try{
    await assert.rejects(()=>recordInstallmentPaymentOperation({db:ctx.db,auth:ctx.auth},{installmentId:'PAR-1',amount:100,method:'pix'},'OP-INST-OVER'),error=>error?.code==='payment_exceeds_balance');
    assert.equal(ctx.db.scalar("SELECT COUNT(*) FROM billing_payments WHERE installment_id='PAR-1'"),0);
    assert.equal(ctx.db.scalar("SELECT paid_amount FROM billing_installments WHERE id='PAR-1'"),0);
    assert.equal(ctx.db.scalar("SELECT paid_amount FROM ledger WHERE id='FIN-PARENT'"),0);
    assert.equal(ctx.db.scalar("SELECT COUNT(*) FROM sync_changes WHERE installation_id=? AND operation_id='OP-INST-OVER'",ctx.installationId),0);
  }finally{ctx.db.close();}
});
