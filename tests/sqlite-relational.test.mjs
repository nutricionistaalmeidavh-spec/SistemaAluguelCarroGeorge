import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import relationalModule from '../electron/relational-store.cjs';
import { buildLegacySnapshotFixture } from './fixtures/build-legacy-snapshot.mjs';
import { assertSnapshotInvariants } from './helpers/snapshot-invariants.mjs';
import { getFinancialSummary } from '../src/domain/commercial-finance.mjs';
import { snapshotToRelational } from '../src/migration/snapshot-to-relational.mjs';
import { relationalToSnapshot } from '../src/migration/relational-to-snapshot.mjs';

const { RelationalStore } = relationalModule;
const migrationsDir = fileURLToPath(new URL('../db/migrations/', import.meta.url));
const context = { installationId:'INSTALL-GEORGE', deviceId:'DEVICE-DESKTOP' };
const storeOptions = { ...context, migrationsDir, snapshotToRelational, relationalToSnapshot };

function tempDatabase() {
  const dir = mkdtempSync(join(tmpdir(), 'locadora-relational-'));
  return { dir, file:join(dir, 'locadora.sqlite') };
}

test('RelationalStore persiste snapshot, fecha e reabre com financeiro equivalente', async () => {
  const { dir, file } = tempDatabase();
  const source = await buildLegacySnapshotFixture();
  const before = getFinancialSummary(source);
  let store;
  try {
    store = RelationalStore.open(file, storeOptions);
    assert.equal(store.isRelationalEmpty(), true);
    store.saveSnapshot(source);
    assert.equal(store.isRelationalEmpty(), false);
    store.close();

    store = RelationalStore.open(file, storeOptions);
    const restored = store.loadSnapshot();
    assertSnapshotInvariants(restored);
    assert.deepEqual(getFinancialSummary(restored), before);
    assert.deepEqual(restored.customers.map(x => x.id).sort(), source.customers.map(x => x.id).sort());
    assert.deepEqual(restored.rentals.map(x => x.id).sort(), source.rentals.map(x => x.id).sort());
    assert.equal(restored.billingInstallments.length, source.billingInstallments.length);
  } finally {
    try { store?.close(); } catch {}
    rmSync(dir, { recursive:true, force:true });
  }
});

test('replaceFromDataset faz rollback completo quando uma referência falha', async () => {
  const { dir, file } = tempDatabase();
  const source = await buildLegacySnapshotFixture();
  const dataset = snapshotToRelational(source, context);
  dataset.rentals.push({
    ...dataset.rentals[0],
    id:'RENTAL-BROKEN',
    customer_id:'CUSTOMER-NOT-FOUND'
  });
  let store;
  try {
    store = RelationalStore.open(file, storeOptions);
    assert.throws(() => store.replaceFromDataset(dataset), /FOREIGN KEY|constraint/i);
    assert.equal(store.isRelationalEmpty(), true);
    assert.equal(store.loadSnapshot().rentals.length, 0);
  } finally {
    try { store?.close(); } catch {}
    rmSync(dir, { recursive:true, force:true });
  }
});
