import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import migrationRunner from '../electron/migration-runner.cjs';

const { applyMigrations } = migrationRunner;
const migrationsDir = fileURLToPath(new URL('../db/migrations/', import.meta.url));
const migrationFiles=['0001_core.sql','0002_commercial.sql','0003_sync_metadata.sql','0004_attachments.sql','0005_auth_sessions.sql','0006_auth_policy.sql','0007_operation_receipts.sql','0008_cloud_attachments.sql','0009_plan03_dr.sql'];

function tableNames(db) {
  return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
}

test('canonical migrations create the relational schema with critical foreign keys', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const result = applyMigrations(db, migrationsDir);
    assert.deepEqual(result.applied, migrationFiles);
    assert.equal(result.version, migrationFiles.length);

    const names = tableNames(db);
    for (const name of [
      'installations','devices','users','customers','vehicles','rentals','rental_payments',
      'expenses','ledger','inspections','inspection_items','maintenance','contract_templates',
      'issued_contracts','billing_plans','billing_installments','collection_actions','audit_log',
      'sync_changes','sync_cursors','attachments','sessions','operation_receipts','schema_migrations',
      'login_throttle','device_credentials','cloud_backups','restore_records'
    ]) assert.ok(names.has(name), `tabela ausente: ${name}`);

    const installationColumns = db.prepare('PRAGMA table_info(installations)').all().map(row => row.name);
    assert.ok(installationColumns.includes('restore_generation'),'installations sem restore_generation');

    const userColumns = db.prepare('PRAGMA table_info(users)').all().map(row => row.name);
    assert.ok(userColumns.includes('must_change_password'),'users sem must_change_password');

    const customerColumns = db.prepare('PRAGMA table_info(customers)').all().map(row => row.name);
    for (const column of ['id','installation_id','created_at','updated_at','version','updated_by_device','deleted_at']) {
      assert.ok(customerColumns.includes(column), `customers sem ${column}`);
    }

    const attachmentColumns = db.prepare('PRAGMA table_info(attachments)').all().map(row => row.name);
    for (const column of ['id','installation_id','entity_type','entity_id','local_path','mime_type','size_bytes','sha256','created_at','created_by','status','updated_at','version','updated_by_device','deleted_at','object_key','storage_backend']) {
      assert.ok(attachmentColumns.includes(column), `attachments sem ${column}`);
    }

    const sessionColumns = db.prepare('PRAGMA table_info(sessions)').all().map(row => row.name);
    for (const column of ['id','installation_id','user_id','token_hash','device_id','user_agent_hash','created_at','last_seen_at','expires_at','revoked_at']) {
      assert.ok(sessionColumns.includes(column), `sessions sem ${column}`);
    }

    const receiptColumns = db.prepare('PRAGMA table_info(operation_receipts)').all().map(row => row.name);
    for (const column of ['installation_id','operation_id','kind','execution_id','result_json','created_at','completed_at']) {
      assert.ok(receiptColumns.includes(column), `operation_receipts sem ${column}`);
    }

    const rentalFks = db.prepare('PRAGMA foreign_key_list(rentals)').all().map(row => row.table);
    assert.ok(rentalFks.includes('customers'));
    assert.ok(rentalFks.includes('vehicles'));
    const attachmentFks = db.prepare('PRAGMA foreign_key_list(attachments)').all().map(row => row.table);
    assert.ok(attachmentFks.includes('installations'));
    const sessionFks = db.prepare('PRAGMA foreign_key_list(sessions)').all().map(row => row.table);
    assert.ok(sessionFks.includes('installations'));
    assert.ok(sessionFks.includes('users'));
    const credentialFks = db.prepare('PRAGMA foreign_key_list(device_credentials)').all().map(row => row.table);
    assert.ok(credentialFks.includes('installations'));
    assert.ok(credentialFks.includes('users'));
    assert.ok(credentialFks.includes('devices'));
  } finally {
    db.close();
  }
});

test('migration runner is idempotent', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const first = applyMigrations(db, migrationsDir);
    const second = applyMigrations(db, migrationsDir);
    assert.equal(first.applied.length, migrationFiles.length);
    assert.deepEqual(second, { applied:[], version:migrationFiles.length });
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM schema_migrations').get().total, migrationFiles.length);
  } finally {
    db.close();
  }
});

test('migration runner rejects changed content for an already applied migration', () => {
  const root = mkdtempSync(join(tmpdir(), 'locadora-migrations-'));
  const copied = join(root, 'migrations');
  cpSync(migrationsDir, copied, { recursive:true });
  const db = new DatabaseSync(':memory:');
  try {
    applyMigrations(db, copied);
    const file = join(copied, '0001_core.sql');
    writeFileSync(file, `${readFileSync(file, 'utf8')}\n-- alteração indevida\n`, 'utf8');
    assert.throws(() => applyMigrations(db, copied), /checksum|alterada|migration/i);
  } finally {
    db.close();
    rmSync(root, { recursive:true, force:true });
  }
});
