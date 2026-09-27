import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptySnapshot } from '../src/domain/rental.mjs';
import { createRentalWithBilling } from '../src/domain/daily-billing.mjs';
import { recordInstallmentPayment } from '../src/domain/commercial.mjs';

test('fase 4: pagamentos das diárias convergem para o histórico da locação', () => {
  const base=createEmptySnapshot();
  base.customers.push({id:'CLI-1',name:'George',document:'1',phone:'1',active:true});
  base.vehicles.push({id:'VEI-1',model:'Onix',plate:'ABC1D23',year:'2026',mileage:0,category:'Compacto',color:'Prata',dailyRate:100,purchasePrice:80000,availability:'disponivel'});
  let snapshot=createRentalWithBilling(base,{vehicleId:'VEI-1',customerId:'CLI-1',attendantId:'USR-001',pickupAt:'2026-10-01T10:00:00',returnAt:'2026-10-03T10:00:00',dailyRate:100,billingMode:'daily'},'USR-001');
  const rentalId=snapshot.rentals[0].id;
  const installments=snapshot.billingInstallments.filter(item=>item.rentalId===rentalId).sort((a,b)=>a.sequence-b.sequence);

  snapshot=recordInstallmentPayment(snapshot,installments[0].id,{amount:60,method:'PIX',paidAt:'2026-10-01T12:00:00Z'},'USR-001');
  snapshot=recordInstallmentPayment(snapshot,installments[0].id,{amount:40,method:'Dinheiro',paidAt:'2026-10-01T12:05:00Z'},'USR-001');

  const rental=snapshot.rentals.find(item=>item.id===rentalId);
  assert.equal(rental.payments.length,2);
  assert.equal(rental.payments.reduce((sum,item)=>sum+item.amount,0),100);
  assert.deepEqual(rental.payments.map(item=>item.method),['PIX','Dinheiro']);
  assert.equal(rental.payments.every(item=>item.installmentId===installments[0].id),true);
});
