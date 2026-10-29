CREATE TABLE IF NOT EXISTS contract_alert_links (
 alert_id TEXT PRIMARY KEY REFERENCES workflow_alerts(id),
 contract_id TEXT NOT NULL REFERENCES managed_contracts(id),
 entry_id TEXT, due_date TEXT
);
CREATE INDEX IF NOT EXISTS contract_alert_links_contract ON contract_alert_links(contract_id);
CREATE TABLE IF NOT EXISTS contract_workflow_events (
 id TEXT PRIMARY KEY, contract_id TEXT NOT NULL REFERENCES managed_contracts(id),
 country_code TEXT NOT NULL, actor_id TEXT REFERENCES users(id),
 event_type TEXT NOT NULL, rule TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS contract_workflow_events_scope ON contract_workflow_events(country_code,created_at);
CREATE TABLE IF NOT EXISTS contract_workflow_runs (
 id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users(id), countries TEXT NOT NULL,
 started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, finished_at TEXT,
 status TEXT NOT NULL DEFAULT 'running', evaluated INTEGER NOT NULL DEFAULT 0,
 opened INTEGER NOT NULL DEFAULT 0, resolved INTEGER NOT NULL DEFAULT 0, error TEXT
);
