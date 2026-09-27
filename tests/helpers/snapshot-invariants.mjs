import assert from 'node:assert/strict';
import { getFinancialSummary } from '../../src/domain/commercial-finance.mjs';
import { activeRentalSchedulePlans } from '../../src/domain/daily-billing.mjs';

function ids(list=[]) { return list.map(item => String(item?.id ?? '')).filter(Boolean); }

export function assertSnapshotInvariants(snapshot) {
  for (const key of ['customers','vehicles','rentals','expenses','users','ledger','audit','inspections','maintenance','contractTemplates','issuedContracts','billingPlans','billingInstallments','collectionActions']) {
    assert.ok(Array.isArray(snapshot[key]), `${key} deve ser array`);
  }

  const collections = ['customers','vehicles','rentals','expenses','users','ledger','audit','inspections','maintenance','contractTemplates','issuedContracts','billingPlans','billingInstallments','collectionActions'];
  const allIds = collections.flatMap(key => ids(snapshot[key]));
  assert.equal(new Set(allIds).size, allIds.length, 'IDs devem ser globalmente únicos entre entidades da fixture');

  const customerIds = new Set(ids(snapshot.customers));
  const vehicleIds = new Set(ids(snapshot.vehicles));
  const rentalIds = new Set(ids(snapshot.rentals));
  const planIds = new Set(ids(snapshot.billingPlans));
  const installmentIds = new Set(ids(snapshot.billingInstallments));

  for (const rental of snapshot.rentals) {
    assert.ok(customerIds.has(String(rental.customerId)), `cliente ausente para locação ${rental.id}`);
    assert.ok(vehicleIds.has(String(rental.vehicleId)), `veículo ausente para locação ${rental.id}`);
  }
  for (const plan of snapshot.billingPlans) assert.ok(rentalIds.has(String(plan.rentalId)), `locação ausente para plano ${plan.id}`);
  for (const item of snapshot.billingInstallments) {
    assert.ok(planIds.has(String(item.planId)), `plano ausente para parcela ${item.id}`);
    assert.ok(rentalIds.has(String(item.rentalId)), `locação ausente para parcela ${item.id}`);
  }
  for (const inspection of snapshot.inspections) assert.ok(rentalIds.has(String(inspection.rentalId)), `locação ausente para vistoria ${inspection.id}`);
  for (const contract of snapshot.issuedContracts) assert.ok(rentalIds.has(String(contract.rentalId)), `locação ausente para contrato ${contract.id}`);

  for (const entry of snapshot.ledger) {
    if (entry.rentalId) assert.ok(rentalIds.has(String(entry.rentalId)), `locação ausente para lançamento ${entry.id}`);
    if (entry.installmentId) assert.ok(installmentIds.has(String(entry.installmentId)), `parcela ausente para lançamento ${entry.id}`);
  }

  const summary = getFinancialSummary(snapshot);
  assert.equal(summary.openAmount, Math.round((summary.grossRevenue - summary.paidAmount) * 100) / 100);
  assert.equal(summary.netCash, Math.round((summary.paidAmount - summary.expensesAmount) * 100) / 100);

  const scheduleRentalIds = new Set(activeRentalSchedulePlans(snapshot).map(plan => plan.rentalId));
  const expectedGross = snapshot.ledger
    .filter(entry => entry.status !== 'cancelled')
    .filter(entry => entry.kind === 'billing_receivable' || (entry.kind === 'receivable' && !scheduleRentalIds.has(entry.rentalId)))
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  assert.equal(summary.grossRevenue, Math.round(expectedGross * 100) / 100, 'rental_schedule não pode duplicar receita');
}
