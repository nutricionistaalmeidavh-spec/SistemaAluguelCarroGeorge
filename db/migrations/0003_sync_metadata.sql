CREATE TABLE IF NOT EXISTS sync_changes (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id TEXT NOT NULL UNIQUE,
  installation_id TEXT NOT NULL REFERENCES installations(id),
  device_id TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  base_version INTEGER,
  entity_version INTEGER,
  payload_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sync_changes_installation_sequence ON sync_changes(installation_id, sequence);

CREATE TABLE IF NOT EXISTS sync_cursors (
  installation_id TEXT NOT NULL REFERENCES installations(id),
  device_id TEXT NOT NULL,
  cursor INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(installation_id, device_id)
);
