ALTER TABLE installations ADD COLUMN restore_generation INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS login_throttle (
  key_hash TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT NOT NULL,
  blocked_until TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_credentials (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES installations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  device_id TEXT NOT NULL REFERENCES devices(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_device_credentials_installation_device ON device_credentials(installation_id, device_id);

CREATE TABLE IF NOT EXISTS cloud_backups (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES installations(id),
  restore_generation INTEGER NOT NULL DEFAULT 0,
  prefix TEXT NOT NULL,
  manifest_key TEXT,
  manifest_sha256 TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  error_code TEXT
);
CREATE INDEX IF NOT EXISTS idx_cloud_backups_installation_created ON cloud_backups(installation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS restore_records (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES installations(id),
  backup_id TEXT NOT NULL,
  from_generation INTEGER NOT NULL,
  to_generation INTEGER NOT NULL,
  actor_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  error_code TEXT
);
CREATE INDEX IF NOT EXISTS idx_restore_records_installation_created ON restore_records(installation_id, created_at DESC);
