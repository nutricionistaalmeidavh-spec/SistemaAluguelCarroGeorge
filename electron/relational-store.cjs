const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { applyMigrations } = require('./migration-runner.cjs');
const { createCoreRepository } = require('./repositories/core-repository.cjs');
const { createCommercialRepository } = require('./repositories/commercial-repository.cjs');
const { createOperationsRepository } = require('./repositories/operations-repository.cjs');

class RelationalStore {
  static open(filePath, options={}) { return new RelationalStore(filePath, options); }

  constructor(filePath, options={}) {
    if (!filePath) throw new TypeError('filePath é obrigatório.');
    if (!options.migrationsDir) throw new TypeError('migrationsDir é obrigatório.');
    fs.mkdirSync(path.dirname(filePath), { recursive:true });
    this.filePath = filePath;
    this.installationId = String(options.installationId || 'INSTALL-GEORGE');
    this.deviceId = String(options.deviceId || 'DEVICE-DESKTOP');
    this.snapshotToRelational = options.snapshotToRelational ?? null;
    this.relationalToSnapshot = options.relationalToSnapshot ?? null;
    this.db = new DatabaseSync(filePath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
    applyMigrations(this.db, options.migrationsDir);
    this.core = createCoreRepository(this.db);
    this.commercial = createCommercialRepository(this.db);
    this.operations = createOperationsRepository(this.db);
  }

  transaction(fn) {
    if (typeof fn !== 'function') throw new TypeError('transaction exige função.');
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const value = fn({ db:this.db, core:this.core, commercial:this.commercial, operations:this.operations });
      this.db.exec('COMMIT;');
      return value;
    } catch (error) {
      try { this.db.exec('ROLLBACK;'); } catch {}
      throw error;
    }
  }

  isRelationalEmpty() {
    return Number(this.db.prepare('SELECT COUNT(*) AS total FROM installations').get().total || 0) === 0;
  }

  replaceFromDataset(dataset) {
    if (!dataset || typeof dataset !== 'object') throw new TypeError('dataset é obrigatório.');
    return this.transaction(() => {
      this.operations.clear();
      this.commercial.clear();
      this.core.clear();
      this.core.replace(dataset);
      this.commercial.replace(dataset);
      this.operations.replace(dataset);
      return true;
    });
  }

  loadDataset() {
    const dataset = {
      meta:{ snapshot_version:4, updated_at:new Date(0).toISOString(), restore_point_json:null },
      legacy_inspection_photos:[]
    };
    this.core.load(dataset);
    this.commercial.load(dataset);
    this.operations.load(dataset);
    const setting = dataset.app_settings?.[0];
    const installation = dataset.installations?.[0];
    dataset.meta.updated_at = setting?.updated_at ?? installation?.updated_at ?? dataset.meta.updated_at;
    return dataset;
  }

  saveSnapshot(snapshot) {
    if (typeof this.snapshotToRelational !== 'function') throw new Error('snapshotToRelational não configurado.');
    const dataset = this.snapshotToRelational(snapshot, { installationId:this.installationId, deviceId:this.deviceId });
    this.replaceFromDataset(dataset);
    return snapshot;
  }

  loadSnapshot() {
    if (typeof this.relationalToSnapshot !== 'function') throw new Error('relationalToSnapshot não configurado.');
    return this.relationalToSnapshot(this.loadDataset());
  }

  close() {
    try { this.db.close(); } catch {}
  }
}

module.exports = { RelationalStore };
