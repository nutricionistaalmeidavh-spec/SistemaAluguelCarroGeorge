CREATE TABLE IF NOT EXISTS operation_receipts (
  installation_id TEXT NOT NULL REFERENCES installations(id),
  operation_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  result_json TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (installation_id, operation_id)
);
CREATE INDEX IF NOT EXISTS idx_operation_receipts_completed ON operation_receipts(installation_id, completed_at);
