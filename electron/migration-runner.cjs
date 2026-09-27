const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function checksum(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function ensureMigrationTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

function applyMigrations(db, migrationsDir) {
  if (!db?.exec || !db?.prepare) throw new TypeError('DatabaseSync válido é obrigatório.');
  if (!migrationsDir) throw new TypeError('migrationsDir é obrigatório.');
  ensureMigrationTable(db);
  db.exec('PRAGMA foreign_keys=ON;');

  const files = fs.readdirSync(migrationsDir)
    .filter(name => /^\d+_.+\.sql$/.test(name))
    .sort((a,b) => a.localeCompare(b));
  const applied = [];
  const lookup = db.prepare('SELECT checksum FROM schema_migrations WHERE name=?');
  const insert = db.prepare('INSERT INTO schema_migrations(name,checksum,applied_at) VALUES(?,?,?)');

  for (const name of files) {
    const content = fs.readFileSync(path.join(migrationsDir, name), 'utf8');
    const hash = checksum(content);
    const existing = lookup.get(name);
    if (existing) {
      if (existing.checksum !== hash) throw new Error(`Migration ${name} alterada: checksum não confere.`);
      continue;
    }

    db.exec('BEGIN IMMEDIATE;');
    try {
      db.exec(content);
      insert.run(name, hash, new Date().toISOString());
      db.exec('COMMIT;');
      applied.push(name);
    } catch (error) {
      try { db.exec('ROLLBACK;'); } catch {}
      throw error;
    }
  }

  const version = Number(db.prepare('SELECT COUNT(*) AS total FROM schema_migrations').get().total || 0);
  return { applied, version };
}

module.exports = { applyMigrations, checksum };
