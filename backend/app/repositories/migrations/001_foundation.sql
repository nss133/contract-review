CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('operator','knowledge_manager','reviewer','reader')),
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL
);
CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    csrf_token TEXT NOT NULL,
    expires_at REAL NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE login_attempts (
    key TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL,
    expires_at REAL NOT NULL
);
CREATE TABLE reviews (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    text TEXT NOT NULL,
    legacy_hash TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL
);
CREATE TABLE review_memberships (
    review_id TEXT NOT NULL REFERENCES reviews(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    permission TEXT NOT NULL CHECK(permission IN ('read','edit')),
    PRIMARY KEY(review_id,user_id)
);
CREATE TABLE opinion_drafts (
    review_id TEXT NOT NULL REFERENCES reviews(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    text TEXT NOT NULL,
    revision INTEGER NOT NULL,
    updated_at REAL NOT NULL,
    PRIMARY KEY(review_id,user_id)
);
CREATE TABLE audit_events (
    id INTEGER PRIMARY KEY,
    at REAL NOT NULL,
    actor_id TEXT,
    action TEXT NOT NULL,
    target_id TEXT NOT NULL
);
