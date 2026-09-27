CREATE TABLE IF NOT EXISTS installations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by_device TEXT,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES installations(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'desktop',
  active INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by_device TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_devices_installation ON devices(installation_id);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES installations(id),
  username TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  password_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by_device TEXT,
  deleted_at TEXT,
  UNIQUE(installation_id, username)
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES installations(id),
  name TEXT NOT NULL,
  document TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  driver_license_json TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by_device TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_customers_installation ON customers(installation_id);

CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES installations(id),
  model TEXT NOT NULL,
  plate TEXT NOT NULL,
  year TEXT,
  mileage REAL NOT NULL DEFAULT 0,
  category TEXT,
  color TEXT,
  daily_rate REAL NOT NULL DEFAULT 0,
  purchase_price REAL NOT NULL DEFAULT 0,
  availability TEXT NOT NULL DEFAULT 'disponivel',
  documents_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by_device TEXT,
  deleted_at TEXT,
  UNIQUE(installation_id, plate)
);
CREATE INDEX IF NOT EXISTS idx_vehicles_installation ON vehicles(installation_id);

CREATE TABLE IF NOT EXISTS rentals (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES installations(id),
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  attendant_id TEXT REFERENCES users(id),
  pickup_at TEXT NOT NULL,
  return_at TEXT,
  period_mode TEXT NOT NULL DEFAULT 'fixed',
  continuous_closed_at TEXT,
  status TEXT NOT NULL,
  priority TEXT,
  notes TEXT,
  daily_rate REAL NOT NULL DEFAULT 0,
  days INTEGER NOT NULL DEFAULT 1,
  total REAL NOT NULL DEFAULT 0,
  billing_mode TEXT NOT NULL DEFAULT 'total',
  payment_status TEXT NOT NULL DEFAULT 'aberto',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by_device TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_rentals_vehicle_dates ON rentals(vehicle_id, pickup_at, return_at);
CREATE INDEX IF NOT EXISTS idx_rentals_customer ON rentals(customer_id);

CREATE TABLE IF NOT EXISTS rental_payments (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES installations(id),
  rental_id TEXT NOT NULL REFERENCES rentals(id),
  installment_id TEXT,
  amount REAL NOT NULL,
  method TEXT NOT NULL,
  paid_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by_device TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_rental_payments_rental ON rental_payments(rental_id);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES installations(id),
  vehicle_id TEXT REFERENCES vehicles(id),
  description TEXT NOT NULL,
  category TEXT,
  amount REAL NOT NULL,
  due_at TEXT,
  paid INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by_device TEXT,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS inspections (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES installations(id),
  rental_id TEXT NOT NULL REFERENCES rentals(id),
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  mileage REAL,
  fuel_level TEXT,
  notes TEXT,
  damages_json TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by_device TEXT,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS inspection_items (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES installations(id),
  inspection_id TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  label TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  evidence TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by_device TEXT,
  deleted_at TEXT,
  UNIQUE(inspection_id, item_key)
);

CREATE TABLE IF NOT EXISTS maintenance (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES installations(id),
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  type TEXT NOT NULL,
  due_at TEXT,
  due_mileage REAL,
  notes TEXT,
  cost_estimate REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  cost REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by_device TEXT,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES installations(id),
  actor_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details_json TEXT,
  at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by_device TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_installation_at ON audit_log(installation_id, at);

CREATE TABLE IF NOT EXISTS alert_state (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES installations(id),
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by_device TEXT,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS app_settings (
  installation_id TEXT PRIMARY KEY REFERENCES installations(id),
  settings_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by_device TEXT
);
