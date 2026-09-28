import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLegacySnapshotFixture } from './fixtures/build-legacy-snapshot.mjs';
import { assertSnapshotInvariants } from './helpers/snapshot-invariants.mjs';
import { getFinancialSummary } from '../src/domain/commercial-finance.mjs';

test('legacy baseline preserves representative locadora data and financial totals', async () => {
  const snapshot = await buildLegacySnapshotFixture();

  assertSnapshotInvariants(snapshot);
  assert.equal(snapshot.customers.length, 2);
  assert.equal(snapshot.vehicles.length, 2);
  assert.equal(snapshot.rentals.length, 2);
  assert.equal(snapshot.expenses.length, 1);
  assert.equal(snapshot.inspections.length, 1);
  assert.equal(snapshot.inspections[0].photos.length, 1);
  assert.match(snapshot.inspections[0].photos[0].dataUrl, /^data:image\/jpeg;base64,/);
  assert.equal(snapshot.maintenance.length, 1);
  assert.equal(snapshot.contractTemplates.length, 1);
  assert.equal(snapshot.issuedContracts.length, 1);
  assert.equal(snapshot.billingPlans.length, 1);
  assert.equal(snapshot.billingPlans[0].purpose, 'rental_schedule');
  assert.equal(snapshot.billingInstallments.length, 5);

  const summary = getFinancialSummary(snapshot);
  assert.deepEqual(summary, {
    grossRevenue: 700,
    paidAmount: 150,
    openAmount: 550,
    expensesAmount: 60,
    netCash: 90
  });
});
