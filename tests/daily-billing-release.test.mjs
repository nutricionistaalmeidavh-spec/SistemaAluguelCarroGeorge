import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptySnapshot } from '../src/domain/rental.mjs';
import { createRentalWithBilling, dailyBillingSummary, ensureDailyInstallmentsUntil, recordDailyPaymentAmount, recordNextDailyPayment } from '../src/domain/daily-billing.mjs';
import { getFinancialSummary } from '../src/domain/commercial-finance.mjs';
import { createBackupEnvelope, restoreBackupEnvelope } from '../src/domain/backup.mjs';

function base(rate=100){
  const snapshot=createEmptySnapshot();
  snapshot.customers.push({id:'CLI-1',name:'George',document:'1',phone:'1',active:true});
  snapshot.vehicles.push({id:'VEI-1',model:'Onix',plate:'ABC1D23',year:'2026',mileage:0,category:'Compacto',color:'Prata',dailyRate:rate,purchasePrice:80000,availability:'disponivel'});
  return snapshot;
}
function fixed(days,rate){
  const start=new Date('2026-10-01T10:00:00Z'),end=new Date(start.getTime()+days*86_400_000);
  return createRentalWithBilling(base(rate),{vehicleId:'VEI-1',customerId:'CLI-1',attendantId:'USR-001',pickupAt:start.toISOString(),returnAt:end.toISOString(),dailyRate:rate,billingMode:'daily',periodMode:'fixed'},'USR-001');
}

test('fase 12: dez diárias de R$80 fecham exatamente em R$800',()=>{
  let snapshot=fixed(10,80),rentalId=snapshot.rentals[0].id;
  assert.equal(getFinancialSummary(snapshot).grossRevenue,800);
  snapshot=recordDailyPaymentAmount(snapshot,rentalId,{amount:800,method:'PIX',paidAt:'2026-10-10T12:00:00Z'},'USR-001');
  const finance=getFinancialSummary(snapshot),daily=dailyBillingSummary(snapshot,rentalId,'2026-10-10T12:01:00Z');
  assert.equal(finance.grossRevenue,800);
  assert.equal(finance.paidAmount,800);
  assert.equal(finance.openAmount,0);
  assert.equal(daily.paidCount,10);
  assert.equal(daily.received,800);
});

test('fase 12: diária de R$80 aceita R$30 + R$50 e termina paga',()=>{
  let snapshot=fixed(1,80),rentalId=snapshot.rentals[0].id;
  snapshot=recordNextDailyPayment(snapshot,rentalId,{amount:30,method:'Dinheiro',paidAt:'2026-10-01T11:00:00Z'},'USR-001');
  let daily=dailyBillingSummary(snapshot,rentalId,'2026-10-01T11:01:00Z');
  assert.equal(daily.partialCount,1);
  assert.equal(daily.openAmount,50);
  snapshot=recordNextDailyPayment(snapshot,rentalId,{amount:50,method:'PIX',paidAt:'2026-10-01T11:05:00Z'},'USR-001');
  daily=dailyBillingSummary(snapshot,rentalId,'2026-10-01T11:06:00Z');
  assert.equal(daily.paidCount,1);
  assert.equal(daily.openAmount,0);
  assert.equal(snapshot.rentals[0].payments.length,2);
});

test('fase 12: cinco diárias de R$100 nunca duplicam receita para R$1.000',()=>{
  const snapshot=fixed(5,100),finance=getFinancialSummary(snapshot);
  assert.equal(snapshot.billingInstallments.length,5);
  assert.equal(finance.grossRevenue,500);
  assert.equal(finance.openAmount,500);
});

test('fase 12: backup e restore preservam agenda contínua, pagamentos e saldos',async()=>{
  let snapshot=createRentalWithBilling(base(100),{vehicleId:'VEI-1',customerId:'CLI-1',attendantId:'USR-001',pickupAt:'2026-10-01T10:00:00Z',dailyRate:100,billingMode:'daily',periodMode:'continuous'},'USR-001');
  const rentalId=snapshot.rentals[0].id;
  snapshot=ensureDailyInstallmentsUntil(snapshot,rentalId,'2026-10-03T10:00:01Z','SYSTEM');
  snapshot=recordDailyPaymentAmount(snapshot,rentalId,{amount:150,method:'PIX',paidAt:'2026-10-03T11:00:00Z'},'USR-001');
  const before=dailyBillingSummary(snapshot,rentalId,'2026-10-03T11:01:00Z');
  const envelope=await createBackupEnvelope(snapshot),restored=await restoreBackupEnvelope(envelope),after=dailyBillingSummary(restored,rentalId,'2026-10-03T11:01:00Z');
  assert.equal(restored.rentals[0].periodMode,'continuous');
  assert.equal(restored.billingPlans.length,1);
  assert.equal(restored.billingInstallments.length,3);
  assert.equal(restored.rentals[0].payments.length,2);
  assert.deepEqual({received:after.received,openAmount:after.openAmount,paidCount:after.paidCount,partialCount:after.partialCount},{received:before.received,openAmount:before.openAmount,paidCount:before.paidCount,partialCount:before.partialCount});
  assert.equal(getFinancialSummary(restored).grossRevenue,300);
  assert.equal(getFinancialSummary(restored).paidAmount,150);
});
