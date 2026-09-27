import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptySnapshot } from '../src/domain/rental.mjs';
import { createRentalWithBilling, dailyBillingSummary, nextDailyInstallment, recordDailyPaymentAmount } from '../src/domain/daily-billing.mjs';
import { dailyFinancialSummary } from '../src/domain/commercial-finance.mjs';

function baseSnapshot() {
  const snapshot = createEmptySnapshot();
  snapshot.customers.push({ id:'CLI-1', name:'George', document:'1', phone:'1', active:true });
  snapshot.vehicles.push({ id:'VEI-1', model:'Onix', plate:'ABC1D23', year:'2026', mileage:0, category:'Compacto', color:'Prata', dailyRate:100, purchasePrice:80000, availability:'disponivel' });
  return snapshot;
}

function fiveDayRental() {
  return createRentalWithBilling(baseSnapshot(), {
    vehicleId:'VEI-1', customerId:'CLI-1', attendantId:'USR-001',
    pickupAt:'2026-10-01T10:00:00', returnAt:'2026-10-06T10:00:00',
    dailyRate:100, billingMode:'daily'
  }, 'USR-001');
}

test('fase 5: valor livre quita várias diárias em ordem e deixa a seguinte parcial', () => {
  let snapshot = fiveDayRental();
  const rentalId = snapshot.rentals[0].id;

  snapshot = recordDailyPaymentAmount(snapshot, rentalId, {
    amount:250,
    method:'PIX',
    paidAt:'2026-10-01T12:00:00Z'
  }, 'USR-001');

  const installments = snapshot.billingInstallments
    .filter((item) => item.rentalId === rentalId)
    .sort((a,b) => a.sequence-b.sequence);

  assert.deepEqual(installments.map((item) => item.paidAmount), [100,100,50,0,0]);
  assert.deepEqual(installments.map((item) => item.status), ['paid','paid','partial','open','open']);
  assert.equal(nextDailyInstallment(snapshot, rentalId)?.sequence, 3);

  const rental = snapshot.rentals.find((item) => item.id === rentalId);
  assert.equal(rental.payments.length, 3);
  assert.equal(rental.payments.reduce((sum,item) => sum + item.amount, 0), 250);
  assert.equal(rental.paymentStatus, 'aberto');

  const summary = dailyBillingSummary(snapshot, rentalId, '2026-10-01T12:01:00Z');
  assert.equal(summary.paidCount, 2);
  assert.equal(summary.partialCount, 1);
  assert.equal(summary.received, 250);
  assert.equal(summary.openAmount, 250);

  assert.throws(() => recordDailyPaymentAmount(snapshot, rentalId, {
    amount:251,
    method:'PIX',
    paidAt:'2026-10-01T12:02:00Z'
  }, 'USR-001'), /excede|saldo/i);
});

test('fase 6: financeiro diário separa hoje, recebido hoje e atrasados', () => {
  let snapshot = fiveDayRental();
  const rentalId = snapshot.rentals[0].id;

  snapshot = recordDailyPaymentAmount(snapshot, rentalId, {
    amount:100,
    method:'PIX',
    paidAt:'2026-10-01T12:00:00Z'
  }, 'USR-001');
  snapshot = recordDailyPaymentAmount(snapshot, rentalId, {
    amount:40,
    method:'Dinheiro',
    paidAt:'2026-10-04T09:00:00Z'
  }, 'USR-001');

  const summary = dailyFinancialSummary(snapshot, '2026-10-04T12:00:00Z');
  assert.equal(summary.receivedToday, 40);
  assert.equal(summary.dueToday, 100);
  assert.equal(summary.pendingToday, 100);
  assert.equal(summary.overdueAmount, 60);
  assert.equal(summary.overdueCount, 1);
  assert.equal(summary.rows.length, 1);
  assert.equal(summary.rows[0].rentalId, rentalId);
  assert.equal(summary.rows[0].dailyRate, 100);
  assert.equal(summary.rows[0].paidCount, 1);
  assert.equal(summary.rows[0].overdueCount, 1);
  assert.equal(summary.rows[0].openAmount, 360);
});
