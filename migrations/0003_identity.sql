-- HMT Collabs native identity and approval workflow.
ALTER TABLE users ADD COLUMN country_code TEXT REFERENCES countries(code);
ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'inactive' CHECK(account_status IN ('active','inactive','locked'));
ALTER TABLE users ADD COLUMN password_salt TEXT;
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN password_iterations INTEGER;
ALTER TABLE users ADD COLUMN password_changed_at TEXT;
CREATE TABLE IF NOT EXISTS user_roles(user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL CHECK(role IN ('super_admin','admin','country_lead','regional_manager','group_leader','technician','requester')), PRIMARY KEY(user_id,role));
CREATE TABLE IF NOT EXISTS country_leads(country_code TEXT NOT NULL REFERENCES countries(code), user_id TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(country_code,user_id));
CREATE TABLE IF NOT EXISTS auth_sessions(id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at TEXT NOT NULL, revoked_at TEXT);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id,expires_at);
CREATE TABLE IF NOT EXISTS registration_requests(id TEXT PRIMARY KEY, email TEXT NOT NULL, display_name TEXT NOT NULL, country_code TEXT NOT NULL REFERENCES countries(code), organization_name TEXT, status TEXT NOT NULL DEFAULT 'pending_verification' CHECK(status IN ('pending_verification','pending_approval','approved','rejected')), verification_hash TEXT, verification_expires_at TEXT, reviewed_by TEXT REFERENCES users(id), reviewed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX IF NOT EXISTS idx_registration_open_email ON registration_requests(email) WHERE status IN ('pending_verification','pending_approval');
CREATE TABLE IF NOT EXISTS identity_audit(id TEXT PRIMARY KEY, actor_id TEXT, event_type TEXT NOT NULL, target_id TEXT, country_code TEXT, details TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
