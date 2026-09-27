import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeD1, seedOperationFixture } from './helpers/fake-d1.mjs';
import { createRentalOperation } from '../cloudflare/domain/rentals.mjs';
import { recordRentalPaymentOperation } from '../cloudflare/domain/payments.mjs';

function context(db){const ids=seedOperationFixture(db);return{db,auth:{installationId:ids.installationId,userId:ids.userId,deviceId:'DEV-OPS',role:'admin',active:true},...ids};}

test('duas reservas sobrepostas para o mesmo veículo nunca coexistem',async()=>{
  const db=new FakeD1();
  try{
    const ctx=context(db);
    const input={customerId:ctx.customerId,vehicleId:ctx.vehicleId,pickupAt:'2026-10-01T10:00:00.000Z',returnAt:'2026-10-05T10:00:00.000Z',dailyRate:100,periodMode:'fixed'};
    const first=await createRentalOperation(ctx,input,'OP-RENT-1');
    assert.equal(first.result.status,'reserva');
    await assert.rejects(()=>createRentalOperation(ctx,{...input,pickupAt:'2026-10-03T10:00:00.000Z',returnAt:'2026-10-06T10:00:00.000Z'},'OP-RENT-2'),error=>error?.code==='reservation_conflict');
    assert.equal(db.scalar('SELECT COUNT(*) FROM rentals WHERE installation_id=? AND deleted_at IS NULL',ctx.installationId),1);
    assert.equal(db.scalar("SELECT COUNT(*) FROM ledger WHERE installation_id=? AND kind='receivable'",ctx.installationId),1);
    assert.equal(db.scalar("SELECT COUNT(*) FROM audit_log WHERE installation_id=? AND action='rental.created'",ctx.installationId),1);
  }finally{db.close();}
});

test('retry do mesmo pagamento é idempotente e não duplica caixa/auditoria',async()=>{
  const db=new FakeD1();
  try{
    const ctx=context(db);
    const rental=await createRentalOperation(ctx,{customerId:ctx.customerId,vehicleId:ctx.vehicleId,pickupAt:'2026-10-10T10:00:00.000Z',returnAt:'2026-10-12T10:00:00.000Z',dailyRate:100,periodMode:'fixed'},'OP-RENT-PAY');
    const input={rentalId:rental.result.id,amount:50,method:'pix',paidAt:'2026-10-10T12:00:00.000Z'};
    const one=await recordRentalPaymentOperation(ctx,input,'OP-PAY-1');
    const two=await recordRentalPaymentOperation(ctx,input,'OP-PAY-1');
    const three=await recordRentalPaymentOperation(ctx,input,'OP-PAY-1');
    assert.equal(one.result.id,two.result.id);assert.equal(two.result.id,three.result.id);
    assert.equal(db.scalar('SELECT COUNT(*) FROM rental_payments WHERE installation_id=? AND rental_id=?',ctx.installationId,rental.result.id),1);
    assert.equal(db.scalar('SELECT paid_amount FROM ledger WHERE installation_id=? AND rental_id=? AND kind=?',ctx.installationId,rental.result.id,'receivable'),50);
    assert.equal(db.scalar("SELECT COUNT(*) FROM audit_log WHERE installation_id=? AND action='payment.received'",ctx.installationId),1);
  }finally{db.close();}
});

test('pagamento acima do saldo é rejeitado sem mutação financeira',async()=>{
  const db=new FakeD1();
  try{
    const ctx=context(db);
    const rental=await createRentalOperation(ctx,{customerId:ctx.customerId,vehicleId:ctx.vehicleId,pickupAt:'2026-11-01T10:00:00.000Z',returnAt:'2026-11-02T10:00:00.000Z',dailyRate:80,periodMode:'fixed'},'OP-RENT-OVER');
    await assert.rejects(()=>recordRentalPaymentOperation(ctx,{rentalId:rental.result.id,amount:100,method:'dinheiro'},'OP-PAY-OVER'),error=>error?.code==='payment_exceeds_balance');
    assert.equal(db.scalar('SELECT COUNT(*) FROM rental_payments WHERE installation_id=? AND rental_id=?',ctx.installationId,rental.result.id),0);
    assert.equal(db.scalar('SELECT paid_amount FROM ledger WHERE installation_id=? AND rental_id=? AND kind=?',ctx.installationId,rental.result.id,'receivable'),0);
  }finally{db.close();}
});
