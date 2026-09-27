CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES installations(id),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  local_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT,
  status TEXT NOT NULL DEFAULT 'ready',
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by_device TEXT,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_attachments_entity
  ON attachments(installation_id, entity_type, entity_id, status);

CREATE INDEX IF NOT EXISTS idx_attachments_sha256
  ON attachments(installation_id, sha256);
