-- SOLO YOUR_D1_DATABASE_NAME. Aditivo y repetible. No altera datos comerciales.
CREATE TABLE IF NOT EXISTS team_users (
 id TEXT PRIMARY KEY,
 username TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('admin','operator')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 key_hash TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS team_sessions (
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES team_users(id),
 revision INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS team_sessions_user_idx ON team_sessions(user_id);
CREATE TABLE IF NOT EXISTS team_settings (
 id INTEGER PRIMARY KEY CHECK(id=1),
 shared_access INTEGER NOT NULL DEFAULT 1 CHECK(shared_access IN (0,1))
);
INSERT INTO team_settings(id,shared_access) VALUES(1,1) ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS team_access_events (
 id TEXT PRIMARY KEY,
 actor_id TEXT NOT NULL,
 actor_name TEXT NOT NULL,
 action TEXT NOT NULL,
 target_id TEXT NOT NULL,
 detail TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS team_events_created_idx ON team_access_events(created_at);
CREATE TABLE IF NOT EXISTS team_login_limits (
 bucket TEXT PRIMARY KEY,
 attempts INTEGER NOT NULL,
 reset_at INTEGER NOT NULL
);
