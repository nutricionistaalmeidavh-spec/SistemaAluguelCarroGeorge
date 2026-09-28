CREATE TABLE IF NOT EXISTS ledger (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES installations(id),
  kind TEXT NOT NULL,
  billing_purpose TEXT,
  rental_id TEXT REFERENCES rentals(id),
  expense_id TEXT REFERENCES expenses(id),
  installment_id TEXT,
  vehicle_id TEXT REFERENCES vehicles(id),
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  paid_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  due_at TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by_device TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ledger_rental ON ledger(rental_id);
CREATE INDEX IF NOT EXISTS idx_ledger_installment ON ledger(installment_id);

CREATE TABLE IF NOT EXISTS contract_templates (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES installations(id),
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  template_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by_device TEXT,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS issued_contracts (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES installations(id),
  rental_id TEXT NOT NULL REFERENCES rentals(id),
  template_id TEXT REFERENCES contract_templates(id),
  template_name TEXT NOT NULL,
  template_version INTEGER NOT NULL,
  rendered_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by_device TEXT,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS billing_plans (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES installations(id),
  rental_id TEXT NOT NULL REFERENCES rentals(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  purpose TEXT NOT NULL,
  frequency TEXT NOT NULL,
  custom_days INTEGER,
  amount REAL NOT NULL,
  occurrences INTEGER NOT NULL,
  first_due_at TEXT NOT NULL,
  fine_percent REAL NOT NULL DEFAULT 0,
  interest_monthly_percent REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  generation_mode TEXT,
  generation_closed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by_device TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_billing_plans_rental ON billing_plans(rental_id);

CREATE TABLE IF NOT EXISTS billing_installments (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES installations(id),
  plan_id TEXT NOT NULL REFERENCES billing_plans(id),
  rental_id TEXT NOT NULL REFERENCES rentals(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  sequence INTEGER NOT NULL,
  due_at TEXT NOT NULL,
  amount REAL NOT NULL,
  paid_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  fine_percent REAL NOT NULL DEFAULT 0,
  interest_monthly_percent REAL NOT NULL DEFAULT 0,
  sync_conflict INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by_device TEXT,
  deleted_at TEXT,
  UNIQUE(plan_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_billing_installments_due ON billing_installments(due_at, status);

CREATE TABLE IF NOT EXISTS billing_payments (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES installations(id),
  installment_id TEXT NOT NULL REFERENCES billing_installments(id),
  amount REAL NOT NULL,
  method TEXT NOT NULL,
  paid_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by_device TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_billing_payments_installment ON billing_payments(installment_id);

CREATE TABLE IF NOT EXISTS billing_payment_conflicts (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES installations(id),
  installment_id TEXT NOT NULL REFERENCES billing_installments(id),
  payment_id TEXT,
  reason TEXT NOT NULL,
  payment_json TEXT,
  detected_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by_device TEXT,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS collection_actions (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES installations(id),
  installment_id TEXT NOT NULL REFERENCES billing_installments(id),
  rental_id TEXT NOT NULL REFERENCES rentals(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  channel TEXT NOT NULL,
  note TEXT NOT NULL,
  promise_at TEXT,
  next_action_at TEXT,
  actor_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by_device TEXT,
  deleted_at TEXT
);
