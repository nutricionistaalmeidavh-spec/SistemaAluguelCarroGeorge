import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLegacySnapshotFixture } from './fixtures/build-legacy-snapshot.mjs';
import { assertSnapshotInvariants } from './helpers/snapshot-invariants.mjs';
import { getFinancialSummary } from '../src/domain/commercial-finance.mjs';
import { snapshotToRelational } from '../src/migration/snapshot-to-relational.mjs';
import { relationalToSnapshot } from '../src/migration/relational-to-snapshot.mjs';

const context = { installationId:'INSTALL-GEORGE', deviceId:'DEVICE-MIGRATION' };

function sortedIds(list=[]) {
  return list.map(item => item.id).sort();
}

test('snapshot relacional round-trip preserva identidade, financeiro, auditoria e foto legada', async () => {
  const source = await buildLegacySnapshotFixture();
  const before = getFinancialSummary(source);

  const dataset = snapshotToRelational(source, context);
  assert.equal(dataset.installations.length, 1);
  assert.equal(dataset.installations[0].id, context.installationId);
  assert.equal(dataset.devices.length, 1);
  assert.equal(dataset.devices[0].id, context.deviceId);
  assert.equal(dataset.customers.length, source.customers.length);
  assert.equal(dataset.vehicles.length, source.vehicles.length);
  assert.equal(dataset.rentals.length, source.rentals.length);
  assert.equal(dataset.billing_installments.length, source.billingInstallments.length);
  assert.equal(dataset.legacy_inspection_photos.length, 1);
  assert.match(dataset.legacy_inspection_photos[0].data_url, /^data:image\/jpeg;base64,/);

  const restored = relationalToSnapshot(dataset);
  assertSnapshotInvariants(restored);

  assert.deepEqual(sortedIds(restored.customers), sortedIds(source.customers));
  assert.deepEqual(sortedIds(restored.vehicles), sortedIds(source.vehicles));
  assert.deepEqual(sortedIds(restored.rentals), sortedIds(source.rentals));
  assert.deepEqual(sortedIds(restored.audit), sortedIds(source.audit));
  assert.deepEqual(getFinancialSummary(restored), before);

  const sourcePayments = source.rentals.flatMap(rental => rental.payments ?? []).map(payment => payment.id).sort();
  const restoredPayments = restored.rentals.flatMap(rental => rental.payments ?? []).map(payment => payment.id).sort();
  assert.deepEqual(restoredPayments, sourcePayments);
  assert.equal(restored.inspections[0].photos.length, 1);
  assert.match(restored.inspections[0].photos[0].dataUrl, /^data:image\/jpeg;base64,/);
});

test('snapshot incompleto normaliza coleções opcionais para arrays vazios', () => {
  const source = {
    version:2,
    updatedAt:'2026-09-27T12:00:00.000Z',
    settings:{ companyName:'George' },
    customers:[], vehicles:[], rentals:[], expenses:[], users:[], ledger:[], audit:[], inspections:[]
  };

  const dataset = snapshotToRelational(source, context);
  const restored = relationalToSnapshot(dataset);

  for (const key of ['maintenance','contractTemplates','issuedContracts','billingPlans','billingInstallments','collectionActions']) {
    assert.deepEqual(restored[key], [], `${key} deveria ser array vazio`);
  }
  assert.deepEqual(restored.alertState, {});
  assert.equal(restored.settings.companyName, 'George');
});
