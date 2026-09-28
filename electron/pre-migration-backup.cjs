const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

function fileSha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function safeTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function createPreMigrationBackup({ databasePath, userData, reason='relational-migration', now=new Date() } = {}) {
  if (!databasePath || !fs.existsSync(databasePath)) throw new Error('Banco de dados para backup não encontrado.');
  if (!userData) throw new TypeError('userData é obrigatório.');

  const checkpoint = new DatabaseSync(databasePath);
  try { checkpoint.exec('PRAGMA wal_checkpoint(FULL);'); } finally { checkpoint.close(); }

  const dir = path.join(userData, 'backups', 'pre-migration');
  fs.mkdirSync(dir, { recursive:true });
  const base = `pre-relational-${safeTimestamp(now)}`;
  const backupPath = path.join(dir, `${base}.sqlite`);
  const manifestPath = path.join(dir, `${base}.json`);
  fs.copyFileSync(databasePath, backupPath);
  const sha256 = fileSha256(backupPath);
  const manifest = {
    format:'artisys-locadora-pre-migration-backup',
    createdAt:now.toISOString(),
    reason:String(reason),
    source:path.basename(databasePath),
    backup:path.basename(backupPath),
    sha256
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  return { path:backupPath, sha256, manifestPath };
}

module.exports = { createPreMigrationBackup, fileSha256 };
