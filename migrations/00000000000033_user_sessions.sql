-- Per-session metadata for the user-facing "Active sessions" panel.
--
-- tower-sessions owns the authoritative session rows
-- (tower_sessions.session: id / opaque data / expiry) but nothing there is
-- queryable by user. This side table maps each live session to its user
-- with the metadata the Security page shows (IP, user-agent, first/last
-- seen). Rows are upserted lazily by the auth extractor on each
-- authenticated request (throttled), so every login path — password,
-- Google, verify-email — is covered without touching the mint sites.
--
-- `id` is the surrogate exposed to the client; `session_id` is the tower
-- session id, which is bearer-equivalent and must never leave the server.
-- Rows whose tower session disappeared (expiry sweep, logout, revoke) are
-- purged by the worker's retention pass.
CREATE TABLE user_sessions (
    id           UUID PRIMARY KEY,
    session_id   TEXT NOT NULL UNIQUE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip           INET,
    user_agent   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX user_sessions_user_idx ON user_sessions (user_id, last_seen_at DESC);
