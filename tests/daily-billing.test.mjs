import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptySnapshot, createRental, registerPayment } from '../src/domain/rental.mjs';
import { createBillingPlan, recordInstallmentPayment } from '../src/domain/commercial.mjs';
import { getFinancialSummary, financialReceivables } from '../src/domain/commercial-finance.mjs';
import { markRentalSchedulePurpose, createRentalWithBilling, dailyBillingSummary, nextDailyInstallment, recordNextDailyPayment } from '../src/domain/daily-billing.mjs';

function baseSnapshot() {
  const snapshot = createEmptySnapshot();
  snapshot.customers.push({ id:'CLI-1', name:'George', document:'1', phone:'1', active:true });
  snapshot.vehicles.push({ id:'VEI-1', model:'Onix', plate:'ABC1D23', year:'2025', mileage:0, category:'Compacto', color:'Prata', dailyRate:100, purchasePrice:80000, availability:'disponivel' });
  return snapshot;
}

function rentalDraft(overrides={}) {
  return {
    vehicleId:'VEI-1', customerId:'CLI-1', attendantId:'USR-001',
    pickupAt:'2026-10-01T10:00:00', returnAt:'2026-10-11T10:00:00',
    dailyRate:100, notes:'', ...overrides
  };
}

function fiveDayRental() {
  return createRentalWithBilling(baseSnapshot(), rentalDraft({ returnAt:'2026-10-06T10:00:00', billingMode:'daily' }), 'USR-001');
}

test('fase 0: agenda diária não duplica receita da locação', () => {
  let snapshot = createRental(baseSnapshot(), rentalDraft(), 'USR-001');
  const rental = snapshot.rentals[0];
  snapshot = createBillingPlan(snapshot, {
    rentalId:rental.id, frequency:'daily', firstDueAt:'2026-10-01', amount:100, occurrences:10,
    finePercent:0, interestMonthlyPercent:0
  }, 'USR-001');
  snapshot = markRentalSchedulePurpose(snapshot, snapshot.billingPlans[0].id);

  const summary = getFinancialSummary(snapshot);
  assert.equal(snapshot.billingInstallments.length, 10);
  assert.equal(summary.grossRevenue, 1000);
  assert.equal(summary.paidAmount, 0);
  assert.equal(summary.openAmount, 1000);
  assert.equal(financialReceivables(snapshot).length, 10, 'recebível pai deve ser substituído operacionalmente pelas 10 diárias');
});

test('fase 0: cobrança adicional continua somando receita', () => {
  let snapshot = createRental(baseSnapshot(), rentalDraft({ returnAt:'2026-10-03T10:00:00' }), 'USR-001');
  const rental = snapshot.rentals[0];
  snapshot = createBillingPlan(snapshot, {
    rentalId:rental.id, frequency:'weekly', firstDueAt:'2026-10-01', amount:50, occurrences:1,
    finePercent:0, interestMonthlyPercent:0
  }, 'USR-001');
  const summary = getFinancialSummary(snapshot);
  assert.equal(summary.grossRevenue, 250);
  assert.equal(summary.openAmount, 250);
});

test('fase 1: reserva diária cria locação e cinco parcelas atomicamente', () => {
  const original = baseSnapshot();
  const snapshot = createRentalWithBilling(original, rentalDraft({ returnAt:'2026-10-06T10:00:00', billingMode:'daily' }), 'USR-001');
  const rental = snapshot.rentals[0];
  const plan = snapshot.billingPlans.find((item) => item.rentalId === rental.id);
  const installments = snapshot.billingInstallments.filter((item) => item.planId === plan.id);

  assert.equal(original.rentals.length, 0, 'entrada não deve ser parcialmente mutada');
  assert.equal(rental.days, 5);
  assert.equal(rental.total, 500);
  assert.equal(rental.billingMode, 'daily');
  assert.equal(plan.purpose, 'rental_schedule');
  assert.equal(plan.frequency, 'daily');
  assert.equal(plan.amount, 100);
  assert.equal(plan.occurrences, 5);
  assert.deepEqual(installments.map((item) => item.dueAt), ['2026-10-01','2026-10-02','2026-10-03','2026-10-04','2026-10-05']);
  assert.equal(snapshot.audit.some((item) => item.action === 'rental.created'), true);
  assert.equal(snapshot.audit.some((item) => item.action === 'billing_plan.created'), true);
});

test('fase 1: modo total preserva uma locação sem agenda diária', () => {
  const snapshot = createRentalWithBilling(baseSnapshot(), rentalDraft({ returnAt:'2026-10-03T10:00:00', billingMode:'total' }), 'USR-001');
  assert.equal(snapshot.rentals[0].billingMode, 'total');
  assert.equal(snapshot.billingPlans.length, 0);
  assert.equal(snapshot.billingInstallments.length, 0);
  assert.equal(getFinancialSummary(snapshot).grossRevenue, 200);
});

test('fase 2: resumo mostra cinco diárias, duas pagas e trezentos reais em aberto', () => {
  let snapshot = fiveDayRental();
  const rental = snapshot.rentals[0];
  const installments = snapshot.billingInstallments.filter((item) => item.rentalId === rental.id).sort((a,b) => a.sequence-b.sequence);
  snapshot = recordInstallmentPayment(snapshot, installments[0].id, { amount:100, method:'PIX', paidAt:'2026-10-01T12:00:00Z' }, 'USR-001');
  snapshot = recordInstallmentPayment(snapshot, installments[1].id, { amount:100, method:'PIX', paidAt:'2026-10-01T12:05:00Z' }, 'USR-001');

  const summary = dailyBillingSummary(snapshot, rental.id, '2026-10-01T12:10:00Z');
  assert.equal(summary.totalCount, 5);
  assert.equal(summary.paidCount, 2);
  assert.equal(summary.pendingCount, 3);
  assert.equal(summary.received, 200);
  assert.equal(summary.openAmount, 300);
  assert.equal(summary.rows[0].status, 'paid');
  assert.equal(summary.rows[1].status, 'paid');
  assert.equal(summary.rows[2].status, 'pending');
});

test('fase 3: próxima diária avança após quitação e permite parcial', () => {
  let snapshot = fiveDayRental();
  const rental = snapshot.rentals[0];
  const installments = snapshot.billingInstallments.filter((item) => item.rentalId === rental.id).sort((a,b) => a.sequence-b.sequence);
  snapshot = recordInstallmentPayment(snapshot, installments[0].id, { amount:100, method:'PIX', paidAt:'2026-10-01T12:00:00Z' }, 'USR-001');
  snapshot = recordInstallmentPayment(snapshot, installments[1].id, { amount:100, method:'PIX', paidAt:'2026-10-01T12:05:00Z' }, 'USR-001');

  assert.equal(nextDailyInstallment(snapshot, rental.id)?.sequence, 3);
  snapshot = recordNextDailyPayment(snapshot, rental.id, { amount:40, method:'Dinheiro', paidAt:'2026-10-02T09:00:00Z' }, 'USR-001');
  assert.equal(nextDailyInstallment(snapshot, rental.id)?.sequence, 3, 'parcial mantém a mesma diária como próxima');
  snapshot = recordNextDailyPayment(snapshot, rental.id, { amount:60, method:'PIX', paidAt:'2026-10-02T09:05:00Z' }, 'USR-001');
  assert.equal(nextDailyInstallment(snapshot, rental.id)?.sequence, 4);
  assert.equal(snapshot.billingInstallments.find((item) => item.id === installments[2].id).status, 'paid');
});

test('fase 4: pagamentos diários atualizam locação e recebível pai sem dupla contagem', () => {
  let snapshot = fiveDayRental();
  const rentalId = snapshot.rentals[0].id;
  const installments = snapshot.billingInstallments.filter((item) => item.rentalId === rentalId).sort((a,b) => a.sequence-b.sequence);

  snapshot = recordInstallmentPayment(snapshot, installments[0].id, { amount:100, method:'PIX', paidAt:'2026-10-01T12:00:00Z' }, 'USR-001');
  snapshot = recordInstallmentPayment(snapshot, installments[1].id, { amount:100, method:'PIX', paidAt:'2026-10-01T12:05:00Z' }, 'USR-001');
  snapshot = recordInstallmentPayment(snapshot, installments[2].id, { amount:50, method:'PIX', paidAt:'2026-10-02T09:00:00Z' }, 'USR-001');

  let rental = snapshot.rentals.find((item) => item.id === rentalId);
  let parent = snapshot.ledger.find((item) => item.kind === 'receivable' && item.rentalId === rentalId);
  let summary = getFinancialSummary(snapshot);
  assert.equal(parent.paidAmount, 250);
  assert.equal(parent.status, 'partial');
  assert.equal(rental.paymentStatus, 'aberto');
  assert.equal(summary.grossRevenue, 500);
  assert.equal(summary.paidAmount, 250);
  assert.equal(summary.openAmount, 250);
  assert.throws(() => registerPayment(snapshot, rentalId, 10, 'PIX', 'USR-001'), /agenda diária|diárias/i);

  snapshot = recordInstallmentPayment(snapshot, installments[2].id, { amount:50, method:'PIX', paidAt:'2026-10-02T09:05:00Z' }, 'USR-001');
  snapshot = recordInstallmentPayment(snapshot, installments[3].id, { amount:100, method:'PIX', paidAt:'2026-10-03T09:00:00Z' }, 'USR-001');
  snapshot = recordInstallmentPayment(snapshot, installments[4].id, { amount:100, method:'PIX', paidAt:'2026-10-04T09:00:00Z' }, 'USR-001');

  rental = snapshot.rentals.find((item) => item.id === rentalId);
  parent = snapshot.ledger.find((item) => item.kind === 'receivable' && item.rentalId === rentalId);
  summary = getFinancialSummary(snapshot);
  assert.equal(parent.paidAmount, 500);
  assert.equal(parent.status, 'paid');
  assert.equal(rental.paymentStatus, 'pago');
  assert.equal(summary.grossRevenue, 500);
  assert.equal(summary.paidAmount, 500);
  assert.equal(summary.openAmount, 0);
  assert.equal(snapshot.audit.filter((item) => item.action === 'billing_installment.paid').length, 6);
});
