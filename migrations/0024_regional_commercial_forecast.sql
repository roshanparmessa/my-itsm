-- Separate operational and commercial classifications, and maintain FY targets with approval audit.
CREATE TABLE IF NOT EXISTS regional_activity_financials (
 activity_id TEXT PRIMARY KEY REFERENCES regional_activities(id),
 reference TEXT NOT NULL DEFAULT '',
 amount REAL NOT NULL DEFAULT 0 CHECK(amount>=0),
 currency TEXT NOT NULL DEFAULT 'MUR',
 probability INTEGER NOT NULL DEFAULT 0 CHECK(probability BETWEEN 0 AND 100),
 expected_close TEXT,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS regional_forecast_targets (
 id TEXT PRIMARY KEY,
 financial_year TEXT NOT NULL,
 country_code TEXT NOT NULL CHECK(country_code IN ('MU','MG','RW','BI')),
 currency TEXT NOT NULL DEFAULT 'MUR',
 target_amount REAL NOT NULL CHECK(target_amount>=0),
 created_by TEXT NOT NULL REFERENCES users(id),
 updated_by TEXT NOT NULL REFERENCES users(id),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(financial_year,country_code,currency)
);
CREATE TABLE IF NOT EXISTS regional_forecast_audit (
 id TEXT PRIMARY KEY,
 target_id TEXT NOT NULL REFERENCES regional_forecast_targets(id),
 actor_id TEXT NOT NULL REFERENCES users(id),
 previous_amount REAL,
 new_amount REAL NOT NULL,
 changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_regional_financial_close ON regional_activity_financials(expected_close);
CREATE INDEX IF NOT EXISTS idx_regional_forecast_year ON regional_forecast_targets(financial_year,country_code);
