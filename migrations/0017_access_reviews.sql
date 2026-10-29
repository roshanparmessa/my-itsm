CREATE TABLE IF NOT EXISTS access_reviews (
 id TEXT PRIMARY KEY,
 subject_user_id TEXT NOT NULL REFERENCES users(id),
 reviewer_id TEXT NOT NULL REFERENCES users(id),
 decision TEXT NOT NULL CHECK(decision IN ('retain','revoke','flag')),
 notes TEXT NOT NULL DEFAULT '',
 reviewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_access_reviews_subject ON access_reviews(subject_user_id,reviewed_at);
CREATE INDEX IF NOT EXISTS idx_access_reviews_reviewer ON access_reviews(reviewer_id,reviewed_at);
