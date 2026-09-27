import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import upgradeModule from '../electron/legacy-upgrade.cjs';
import relationalModule from '../electron/relational-store.cjs';
import { buildLegacySnapshotFixture } from './fixtures/build-legacy-snapshot.mjs';
import { getFinancialSummary } from '../src/domain/commercial-finance.mjs';
import { snapshotToRelational } from '../src/migration/snapshot-to-relational.mjs';
import { relationalToSnapshot } from '../src/migration/relational-to-snapshot.mjs';

const { upgradeLegacyDatabase, UPGRADE_MARKER_KEY } = upgradeModule;
const { RelationalStore } = relationalModule;
const migrationsDir = fileURLToPath(new URL('../db/migrations/', import.meta.url));
const context = { installationId:'INSTALL-GEORGE', deviceId:'DEVICE-DESKTOP' };

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function backupFiles(userData) {
  const dir = join(userData, 'backups', 'pre-migration');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(name => name.endsWith('.sqlite'));
}

test('upgrade legado cria backup verificável, importa uma vez e preserva snapshot antigo', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'locadora-upgrade-'));
  const databasePath = join(userData, 'locadora-george.sqlite');
  const source = await buildLegacySnapshotFixture();
  const before = getFinancialSummary(source);

  let legacy = new DatabaseSync(databasePath);
  legacy.exec(`CREATE TABLE kv(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL)`);
  legacy.prepare('INSERT INTO kv(key,value,updated_at) VALUES(?,?,?)').run('app:snapshot:v3', JSON.stringify(source), new Date().toISOString());
  legacy.close();

  try {
    const first = upgradeLegacyDatabase({
      databasePath, userData, migrationsDir, ...context, snapshotToRelational, relationalToSnapshot
    });
    assert.equal(first.migrated, true);
    assert.ok(existsSync(first.backup.path));
    assert.equal(first.backup.sha256, sha256(first.backup.path));
    assert.match(first.backup.sha256, /^[a-f0-9]{64}$/);
    assert.equal(backupFiles(userData).length, 1);

    const store = RelationalStore.open(databasePath, { ...context, migrationsDir, snapshotToRelational, relationalToSnapshot });
    const restored = store.loadSnapshot();
    store.close();
    assert.deepEqual(getFinancialSummary(restored), before);
    assert.equal(restored.customers.length, source.customers.length);
    assert.equal(restored.rentals.length, source.rentals.length);

    legacy = new DatabaseSync(databasePath);
    const snapshotRaw = legacy.prepare('SELECT value FROM kv WHERE key=?').get('app:snapshot:v3')?.value;
    const marker = legacy.prepare('SELECT value FROM kv WHERE key=?').get(UPGRADE_MARKER_KEY)?.value;
    legacy.close();
    assert.ok(snapshotRaw, 'snapshot legado deve permanecer durante a transição');
    assert.equal(JSON.parse(snapshotRaw).rentals.length, source.rentals.length);
    assert.equal(JSON.parse(marker).status, 'completed');

    const second = upgradeLegacyDatabase({
      databasePath, userData, migrationsDir, ...context, snapshotToRelational, relationalToSnapshot
    });
    assert.equal(second.migrated, false);
    assert.equal(second.reason, 'already-migrated');
    assert.equal(backupFiles(userData).length, 1, 'segundo start não deve criar novo backup/importação');
  } finally {
    rmSync(userData, { recursive:true, force:true });
  }
});
