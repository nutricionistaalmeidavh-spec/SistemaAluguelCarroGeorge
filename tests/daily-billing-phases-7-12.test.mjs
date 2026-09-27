import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptySnapshot } from '../src/domain/rental.mjs';
import {
  closeContinuousDailyRental,
  createRentalWithBilling,
  dailyBillingSummary,
  ensureDailyInstallmentsUntil,
  ensureOpenDailyRentals
} from '../src/domain/daily-billing.mjs';
import { recordInstallmentPayment } from '../src/domain/commercial.mjs';
import { dailyDelinquencySummary, getFinancialSummary } from '../src/domain/commercial-finance.mjs';
import { dailyPaymentReceiptPdf } from '../src/domain/documents.mjs';
import { mergeSnapshots } from '../src/domain/sync.mjs';

function baseSnapshot(){
  const snapshot=createEmptySnapshot();
  snapshot.customers.push({id:'CLI-1',name:'George',document:'123',phone:'16999999999',active:true});
  snapshot.vehicles.push({id:'VEI-1',model:'Onix',plate:'ABC1D23',year:'2026',mileage:0,category:'Compacto',color:'Prata',dailyRate:100,purchasePrice:80000,availability:'disponivel'});
  return snapshot;
}

function continuous(){
  return createRentalWithBilling(baseSnapshot(),{
    vehicleId:'VEI-1',customerId:'CLI-1',attendantId:'USR-001',pickupAt:'2026-10-01T10:00:00Z',
    dailyRate:100,billingMode:'daily',periodMode:'continuous',priority:'Media',notes:''
  },'USR-001');
}

function fixed(days=3,rate=100){
  const start=new Date('2026-10-01T10:00:00Z');
  const end=new Date(start.getTime()+days*86_400_000);
  const snapshot=baseSnapshot();
  snapshot.vehicles[0].dailyRate=rate;
  return createRentalWithBilling(snapshot,{
    vehicleId:'VEI-1',customerId:'CLI-1',attendantId:'USR-001',pickupAt:start.toISOString(),returnAt:end.toISOString(),
    dailyRate:rate,billingMode:'daily',periodMode:'fixed',priority:'Media',notes:''
  },'USR-001');
}

test('fase 7: locação contínua nasce com uma diária e cresce apenas quando completa nova diária',()=>{
  let snapshot=continuous();
  const rentalId=snapshot.rentals[0].id;
  assert.equal(snapshot.rentals[0].periodMode,'continuous');
  assert.equal(snapshot.rentals[0].returnAt,null);
  assert.equal(snapshot.rentals[0].days,1);
  assert.equal(snapshot.rentals[0].total,100);
  assert.equal(snapshot.billingInstallments.length,1);

  snapshot=ensureDailyInstallmentsUntil(snapshot,rentalId,'2026-10-02T09:59:59Z','SYSTEM');
  assert.equal(snapshot.billingInstallments.length,1,'antes de 24h não nasce segunda diária');
  snapshot=ensureDailyInstallmentsUntil(snapshot,rentalId,'2026-10-02T10:00:01Z','SYSTEM');
  assert.equal(snapshot.billingInstallments.length,2);
  assert.equal(snapshot.rentals[0].days,2);
  assert.equal(snapshot.rentals[0].total,200);
  assert.equal(snapshot.ledger.find(e=>e.kind==='receivable'&&e.rentalId===rentalId).amount,200);

  const repeated=ensureDailyInstallmentsUntil(snapshot,rentalId,'2026-10-02T10:00:01Z','SYSTEM');
  assert.equal(repeated.billingInstallments.length,2,'acréscimo deve ser idempotente');
});

test('fase 7: accrual global atualiza somente locações contínuas abertas',()=>{
  let snapshot=continuous();
  const rentalId=snapshot.rentals[0].id;
  snapshot=ensureOpenDailyRentals(snapshot,'2026-10-03T10:00:01Z','SYSTEM');
  assert.equal(snapshot.billingInstallments.filter(i=>i.rentalId===rentalId).length,3);
  assert.equal(snapshot.rentals[0].total,300);
});

test('fase 8: encerramento contínuo exige vistoria de devolução, fecha geração e mantém dívida em aberto',()=>{
  let snapshot=continuous();
  const rentalId=snapshot.rentals[0].id;
  snapshot.rentals[0].status='em_uso';
  snapshot.vehicles[0].availability='locado';
  assert.throws(()=>closeContinuousDailyRental(snapshot,rentalId,{returnAt:'2026-10-03T10:05:00Z'},'USR-001'),/vistoria de devolução/i);

  snapshot.inspections=[{id:'VIS-RETURN',rentalId,kind:'return',status:'completed',updatedAt:'2026-10-03T10:04:00Z'}];
  snapshot=closeContinuousDailyRental(snapshot,rentalId,{returnAt:'2026-10-03T10:05:00Z'},'USR-001');
  const rental=snapshot.rentals.find(r=>r.id===rentalId);
  const plan=snapshot.billingPlans.find(p=>p.rentalId===rentalId&&p.purpose==='rental_schedule');
  assert.equal(rental.status,'devolucao');
  assert.equal(rental.continuousClosedAt,'2026-10-03T10:05:00.000Z');
  assert.equal(rental.days,3);
  assert.equal(rental.total,300);
  assert.equal(rental.paymentStatus,'aberto','devolver veículo não quita dívida');
  assert.equal(plan.generationClosedAt,'2026-10-03T10:05:00.000Z');
  assert.equal(snapshot.vehicles[0].availability,'disponivel');
  assert.equal(snapshot.billingInstallments.filter(i=>i.rentalId===rentalId).length,3);
  const after=ensureOpenDailyRentals(snapshot,'2026-10-10T10:00:00Z','SYSTEM');
  assert.equal(after.billingInstallments.filter(i=>i.rentalId===rentalId).length,3,'encerrada não gera novas diárias');
});

test('fase 9: inadimplência diária separa vencidas de hoje e futuras',()=>{
  const snapshot=fixed(4,100);
  const summary=dailyDelinquencySummary(snapshot,'2026-10-04T12:00:00Z');
  assert.equal(summary.overdueCount,2);
  assert.equal(summary.overdueAmount,200);
  assert.deepEqual(summary.rows.map(r=>r.sequence),[1,2]);
  assert.equal(summary.rows.every(r=>r.customerId==='CLI-1'&&r.vehicleId==='VEI-1'),true);
});

test('fase 10: recibo PDF identifica pagamento, diária, cliente e veículo',()=>{
  let snapshot=fixed(1,100);
  const installment=snapshot.billingInstallments[0];
  snapshot=recordInstallmentPayment(snapshot,installment.id,{amount:100,method:'PIX',paidAt:'2026-10-01T12:34:00Z'},'USR-001');
  const paid=snapshot.billingInstallments[0].payments[0];
  const bytes=dailyPaymentReceiptPdf(snapshot,installment.id,paid.id);
  const text=new TextDecoder().decode(bytes);
  assert.equal(text.startsWith('%PDF-1.4'),true);
  assert.match(text,/George/);
  assert.match(text,/Onix/);
  assert.match(text,/ABC1D23/);
  assert.match(text,/PIX/);
  assert.match(text,/Diaria: 1/);
});

test('fase 11: sync preserva pagamentos concorrentes em diárias diferentes e reconcilia locação',()=>{
  const base=fixed(3,100);
  const [first,second]=base.billingInstallments.sort((a,b)=>a.sequence-b.sequence);
  const server=recordInstallmentPayment(base,first.id,{amount:100,method:'PIX',paidAt:'2026-10-01T12:00:00Z'},'USR-PC');
  const client=recordInstallmentPayment(base,second.id,{amount:100,method:'Dinheiro',paidAt:'2026-10-01T12:01:00Z'},'USR-MOB');
  const merged=mergeSnapshots(server,client);
  assert.equal(merged.billingInstallments.filter(i=>i.status==='paid').length,2);
  assert.equal(merged.rentals[0].payments.length,2);
  assert.equal(merged.ledger.find(e=>e.kind==='receivable'&&e.rentalId===merged.rentals[0].id).paidAmount,200);
  assert.equal(getFinancialSummary(merged).paidAmount,200);
});

test('fase 11: sync soma parciais legítimos da mesma diária até o valor exato',()=>{
  const base=fixed(1,100),id=base.billingInstallments[0].id;
  const server=recordInstallmentPayment(base,id,{amount:60,method:'PIX',paidAt:'2026-10-01T12:00:00Z'},'USR-PC');
  const client=recordInstallmentPayment(base,id,{amount:40,method:'Dinheiro',paidAt:'2026-10-01T12:01:00Z'},'USR-MOB');
  const merged=mergeSnapshots(server,client),item=merged.billingInstallments[0];
  assert.equal(item.paidAmount,100);
  assert.equal(item.status,'paid');
  assert.equal(item.payments.length,2);
  assert.equal((item.paymentConflicts??[]).length,0);
  assert.equal(merged.rentals[0].payments.length,2);
});

test('fase 11: pagamento integral concorrente na mesma diária vira conflito sem dobrar caixa',()=>{
  const base=fixed(1,100),id=base.billingInstallments[0].id;
  const server=recordInstallmentPayment(base,id,{amount:100,method:'PIX',paidAt:'2026-10-01T12:00:00Z'},'USR-PC');
  const client=recordInstallmentPayment(base,id,{amount:100,method:'Dinheiro',paidAt:'2026-10-01T12:01:00Z'},'USR-MOB');
  const merged=mergeSnapshots(server,client),item=merged.billingInstallments[0];
  assert.equal(item.paidAmount,100);
  assert.equal(item.payments.length,1);
  assert.equal(item.paymentConflicts.length,1);
  assert.equal(item.paymentConflicts[0].reason,'concurrent_overpayment');
  assert.equal(merged.rentals[0].payments.length,1);
  assert.equal(getFinancialSummary(merged).paidAmount,100);
});
