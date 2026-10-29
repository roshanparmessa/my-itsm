CREATE TABLE IF NOT EXISTS regional_activities (
 id TEXT PRIMARY KEY,
 title TEXT NOT NULL,
 activity_type TEXT NOT NULL CHECK(activity_type IN ('project','task','poc','rfp','prospection','quotation','workshop','incident','other')),
 status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','planned','in_progress','waiting','completed','cancelled')),
 priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','critical')),
 country_code TEXT NOT NULL CHECK(country_code IN ('MU','MG','RW','BI')),
 customer_id TEXT,
 owner_id TEXT REFERENCES users(id),
 description TEXT NOT NULL DEFAULT '',
 due_date TEXT,
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_regional_activities_country_status ON regional_activities(country_code,status);
CREATE INDEX IF NOT EXISTS idx_regional_activities_owner ON regional_activities(owner_id);
CREATE INDEX IF NOT EXISTS idx_regional_activities_due ON regional_activities(due_date);