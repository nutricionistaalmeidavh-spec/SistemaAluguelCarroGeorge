const { DatabaseSync } = require('node:sqlite');
const { RelationalStore } = require('./relational-store.cjs');
const { createPreMigrationBackup } = require('./pre-migration-backup.cjs');

const LEGACY_SNAPSHOT_KEY = 'app:snapshot:v3';
const UPGRADE_MARKER_KEY = 'migration:relational-v1';

function hasKvTable(db) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='kv'").get());
}

function readKv(db, key) {
  if (!hasKvTable(db)) return null;
  return db.prepare('SELECT value FROM kv WHERE key=?').get(String(key))?.value ?? null;
}

function writeKv(db, key, value) {
  db.prepare(`INSERT INTO kv(key,value,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
    .run(String(key), String(value), new Date().toISOString());
}

function readLegacyState(databasePath) {
  const db = new DatabaseSync(databasePath);
  try {
    const markerRaw = readKv(db, UPGRADE_MARKER_KEY);
    const snapshotRaw = readKv(db, LEGACY_SNAPSHOT_KEY);
    return {
      marker:markerRaw ? JSON.parse(markerRaw) : null,
      snapshotRaw
    };
  } finally {
    db.close();
  }
}

function upgradeLegacyDatabase(options={}) {
  const {
    databasePath, userData, migrationsDir, installationId, deviceId,
    snapshotToRelational, relationalToSnapshot
  } = options;
  if (!databasePath) throw new TypeError('databasePath é obrigatório.');

  const state = readLegacyState(databasePath);
  if (state.marker?.status === 'completed') return { migrated:false, reason:'already-migrated', marker:state.marker };
  if (!state.snapshotRaw) return { migrated:false, reason:'no-legacy-snapshot' };

  let snapshot;
  try { snapshot = JSON.parse(state.snapshotRaw); }
  catch { throw new Error('Snapshot legado inválido; migração cancelada antes de qualquer escrita.'); }

  const backup = createPreMigrationBackup({ databasePath, userData, reason:'legacy-snapshot-to-relational' });
  const store = RelationalStore.open(databasePath, {
    migrationsDir, installationId, deviceId, snapshotToRelational, relationalToSnapshot
  });
  try {
    store.saveSnapshot(snapshot);
    const restored = store.loadSnapshot();
    if ((restored.customers?.length ?? 0) !== (snapshot.customers?.length ?? 0)) throw new Error('Validação pós-migração falhou para clientes.');
    if ((restored.rentals?.length ?? 0) !== (snapshot.rentals?.length ?? 0)) throw new Error('Validação pós-migração falhou para locações.');
    const marker = {
      status:'completed',
      migratedAt:new Date().toISOString(),
      backupPath:backup.path,
      backupSha256:backup.sha256,
      schemaVersion:Number(store.db.prepare('SELECT COUNT(*) AS total FROM schema_migrations').get().total || 0)
    };
    writeKv(store.db, UPGRADE_MARKER_KEY, JSON.stringify(marker));
    return { migrated:true, backup, marker };
  } finally {
    store.close();
  }
}

module.exports = { upgradeLegacyDatabase, UPGRADE_MARKER_KEY, LEGACY_SNAPSHOT_KEY };
