-- OIDC links require explicit approval and do not grant roles.
CREATE TABLE IF NOT EXISTS sso_link_requests (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 issuer TEXT NOT NULL,
 subject TEXT NOT NULL,
 requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 reviewed_by TEXT,
 reviewed_at TEXT,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 UNIQUE(issuer,subject)
);
CREATE INDEX IF NOT EXISTS idx_sso_link_requests_user ON sso_link_requests(user_id);
