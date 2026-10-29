CREATE TABLE IF NOT EXISTS sla_time_entries (
 id TEXT PRIMARY KEY,
 contract_id TEXT NOT NULL REFERENCES managed_contracts(id),
 sla_entry_id TEXT NOT NULL REFERENCES contract_entries(id),
 hours_units INTEGER NOT NULL CHECK(hours_units>0),
 work_date TEXT NOT NULL, engineer TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'recorded' CHECK(status IN ('recorded','void')),
 created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 void_reason TEXT,voided_by TEXT REFERENCES users(id),voided_at TEXT
);
CREATE INDEX IF NOT EXISTS sla_time_contract ON sla_time_entries(contract_id,sla_entry_id,status);
