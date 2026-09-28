'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');

test('pagamento repetido com mesmo operationId produz um único recebimento',async()=>{
  const {FakeD1,seedOperationFixture}=await import('../../tests/helpers/fake-d1.mjs');
  const {recordRentalPaymentOperation}=await import('../../cloudflare/domain/payments.mjs');
  const db=new FakeD1();
  try{
    const ids=seedOperationFixture(db),now='2026-09-27T12:00:00.000Z',rentalId='LOC-IDEMP';
    db.sqlite.prepare(`INSERT INTO rentals (id,installation_id,vehicle_id,customer_id,attendant_id,pickup_at,return_at,period_mode,status,daily_rate,days,total,billing_mode,payment_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(rentalId,ids.installationId,ids.vehicleId,ids.customerId,ids.userId,'2026-09-27T10:00:00.000Z','2026-09-28T10:00:00.000Z','fixed','em_uso',100,1,100,'total','aberto',now,now);
    const auth={installationId:ids.installationId,userId:ids.userId,deviceId:'PHONE-A',role:'admin',active:true},input={rentalId,amount:40,method:'pix',paidAt:now};
    const first=await recordRentalPaymentOperation({db,auth},input,'OP-DR-PAY-1');
    const retry=await recordRentalPaymentOperation({db,auth},input,'OP-DR-PAY-1');
    assert.equal(first.result.id,retry.result.id);
    assert.equal(retry.replayed,true);
    assert.equal(db.scalar('SELECT COUNT(*) FROM rental_payments WHERE rental_id=?',rentalId),1);
    assert.equal(db.scalar('SELECT SUM(amount) FROM rental_payments WHERE rental_id=?',rentalId),40);
    assert.equal(db.scalar("SELECT COUNT(*) FROM sync_changes WHERE operation_id='OP-DR-PAY-1'"),1);
  }finally{db.close();}
});
