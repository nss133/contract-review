CREATE TABLE review_documents (
    id TEXT PRIMARY KEY,
    review_id TEXT NOT NULL REFERENCES reviews(id),
    kind TEXT NOT NULL CHECK(kind IN ('main','annex','base')),
    name TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    content BLOB NOT NULL,
    extraction_json TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at REAL NOT NULL
);
CREATE INDEX document_review ON review_documents(review_id);
CREATE TABLE analyses (
    id TEXT PRIMARY KEY,
    review_id TEXT NOT NULL REFERENCES reviews(id),
    input_revision INTEGER NOT NULL,
    fingerprint TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at REAL NOT NULL
);
CREATE INDEX analysis_review ON analyses(review_id,created_at);
CREATE TABLE review_verdicts (
    review_id TEXT NOT NULL REFERENCES reviews(id),
    check_id TEXT NOT NULL,
    analysis_id TEXT NOT NULL REFERENCES analyses(id),
    verdict TEXT NOT NULL CHECK(verdict IN ('이상없음','검토의견')),
    comment TEXT NOT NULL,
    reason TEXT NOT NULL,
    revision INTEGER NOT NULL,
    updated_by TEXT NOT NULL REFERENCES users(id),
    updated_at REAL NOT NULL,
    PRIMARY KEY(review_id,check_id)
);
CREATE TABLE review_completions (
    id TEXT PRIMARY KEY,
    review_id TEXT NOT NULL REFERENCES reviews(id),
    analysis_id TEXT NOT NULL REFERENCES analyses(id),
    input_revision INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL,
    completed_by TEXT NOT NULL REFERENCES users(id),
    completed_at REAL NOT NULL
);
CREATE INDEX completion_review ON review_completions(review_id,completed_at);
