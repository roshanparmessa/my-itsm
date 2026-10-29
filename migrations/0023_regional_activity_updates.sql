CREATE TABLE IF NOT EXISTS regional_activity_updates (
 id TEXT PRIMARY KEY,
 activity_id TEXT NOT NULL REFERENCES regional_activities(id),
 author_id TEXT NOT NULL REFERENCES users(id),
 note TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_regional_activity_updates_activity ON regional_activity_updates(activity_id,created_at);
