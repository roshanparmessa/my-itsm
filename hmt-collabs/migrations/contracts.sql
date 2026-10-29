CREATE TABLE IF NOT EXISTS managed_contracts (
 id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id),
 reference TEXT NOT NULL COLLATE NOCASE UNIQUE, title TEXT NOT NULL,
 contract_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
 start_date TEXT NOT NULL, end_date TEXT NOT NULL, currency TEXT NOT NULL,
 amount TEXT NOT NULL DEFAULT '', data TEXT NOT NULL DEFAULT '{}',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS managed_contracts_customer ON managed_contracts(customer_id);
CREATE INDEX IF NOT EXISTS managed_contracts_expiry ON managed_contracts(status,end_date);
CREATE TABLE IF NOT EXISTS contract_entries (
 id TEXT PRIMARY KEY, contract_id TEXT NOT NULL REFERENCES managed_contracts(id),
 kind TEXT NOT NULL CHECK(kind IN ('coverage','sla','renewal','obligation','document')),
 data TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS contract_entries_contract ON contract_entries(contract_id,kind);
CREATE TABLE IF NOT EXISTS contract_audit (
 id TEXT PRIMARY KEY, contract_id TEXT NOT NULL REFERENCES managed_contracts(id),
 actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL,
 snapshot TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS contract_audit_contract ON contract_audit(contract_id,created_at);
