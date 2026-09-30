import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeD1, seedOperationFixture } from './helpers/fake-d1.mjs';
import { recordRentalPaymentOperation } from '../cloudflare/domain/payments.mjs';

function setupLegacyDaily(){
  const db=new FakeD1(),ids=seedOperationFixture(db),now='2026-09-27T12:00:00.000Z',rentalId='LOC-LEGACY-DAILY';
  db.sqlite.prepare(`INSERT INTO rentals
    (id,installation_id,vehicle_id,customer_id,attendant_id,pickup_at,return_at,period_mode,status,daily_rate,days,total,billing_mode,payment_status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(rentalId,ids.installationId,ids.vehicleId,ids.customerId,ids.userId,'2026-08-01T10:00:00.000Z','2026-08-03T10:00:00.000Z','fixed','devolucao',80,2,160,'daily','aberto',now,now);
  db.sqlite.prepare(`INSERT INTO ledger
    (id,installation_id,kind,billing_purpose,rental_id,vehicle_id,description,amount,paid_amount,status,due_at,created_at,updated_at)
    VALUES ('FIN-LEGACY',?,'receivable','rental',?,?, 'Locação antiga',160,0,'open','2026-08-03',?,?)`)
    .run(ids.installationId,rentalId,ids.vehicleId,now,now);
  return{db,...ids,rentalId,auth:{installationId:ids.installationId,userId:ids.userId,deviceId:'DEV-LEGACY',role:'admin',active:true}};
}

test('locação diária legada sem parcelas aceita baixa direta e reconcilia ledger',async()=>{
  const ctx=setupLegacyDaily();
  try{
    const result=await recordRentalPaymentOperation({db:ctx.db,auth:ctx.auth},{rentalId:ctx.rentalId,amount:80,method:'PIX',paidAt:'2026-09-30T15:00:00.000Z'},'OP-LEGACY-80');
    assert.equal(result.result.amount,80);
    assert.equal(ctx.db.scalar('SELECT COUNT(*) FROM rental_payments WHERE rental_id=?',ctx.rentalId),1);
    assert.equal(ctx.db.scalar("SELECT paid_amount FROM ledger WHERE id='FIN-LEGACY'"),80);
    assert.equal(ctx.db.scalar("SELECT status FROM ledger WHERE id='FIN-LEGACY'"),'partial');
  }finally{ctx.db.close();}
});

test('locação diária moderna com parcelas continua bloqueando baixa direta',async()=>{
  const ctx=setupLegacyDaily();
  try{
    const now='2026-09-30T15:00:00.000Z';
    dbPrepare(ctx.db,`INSERT INTO billing_plans (id,installation_id,rental_id,customer_id,vehicle_id,purpose,frequency,amount,occurrences,first_due_at,active,created_at,updated_at) VALUES ('PLAN-1',?,?,?,?, 'rental_schedule','daily',80,2,'2026-08-01',1,?,?)`,[ctx.installationId,ctx.rentalId,ctx.customerId,ctx.vehicleId,now,now]);
    dbPrepare(ctx.db,`INSERT INTO billing_installments (id,installation_id,plan_id,rental_id,customer_id,vehicle_id,sequence,due_at,amount,paid_amount,status,created_at,updated_at) VALUES ('PAR-1',?,'PLAN-1',?,?,?,?, '2026-08-01',80,0,'open',?,?)`,[ctx.installationId,ctx.rentalId,ctx.customerId,ctx.vehicleId,1,now,now]);
    await assert.rejects(()=>recordRentalPaymentOperation({db:ctx.db,auth:ctx.auth},{rentalId:ctx.rentalId,amount:80,method:'PIX'},'OP-MODERN-DIRECT'),error=>error?.code==='daily_schedule_required');
    assert.equal(ctx.db.scalar('SELECT COUNT(*) FROM rental_payments WHERE rental_id=?',ctx.rentalId),0);
  }finally{ctx.db.close();}
});

function dbPrepare(db,sql,args){db.sqlite.prepare(sql).run(...args);}
