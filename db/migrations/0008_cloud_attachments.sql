ALTER TABLE attachments ADD COLUMN object_key TEXT;
ALTER TABLE attachments ADD COLUMN storage_backend TEXT NOT NULL DEFAULT 'local';

CREATE UNIQUE INDEX IF NOT EXISTS idx_attachments_object_key
  ON attachments(installation_id, object_key)
  WHERE object_key IS NOT NULL;
