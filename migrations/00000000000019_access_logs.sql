-- Phase 2 / Stage B — per-request access log.
--
-- One row per authenticated HTTP request (the middleware skips
-- infrastructure probes: /health /ready /metrics /openapi.json, the
-- frontend heartbeat /api/v1/ping, and the long-lived WS upgrade
-- /api/v1/ws). Captured fields: method, path, status code, latency,
-- user_id (if a session was attached), client IP + User-Agent +
-- request id. NO request bodies, NO response bodies, NO query strings
-- — the path column is the URI path only.
--
-- Partitioned monthly by `created_at`, matching the
-- `bandwidth_samples` precedent. Operators have to keep partitions
-- ahead of the clock; the runbook covers the maintenance task. Four
-- partitions pre-created here (2026-05 → 2026-08); add more before
-- August or inserts will fail.
--
-- Retention is intentionally unbounded by default (Stage A reversal
-- policy); the Stage D `app_settings.retention_*` knobs will let
-- operators opt back in to a bounded window per jurisdiction.
--
-- See TODO.md → "Phase 2 / Stage B" → "Per-request access log".

CREATE TABLE access_logs (
    id           BIGSERIAL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    -- Sessioned writes get attributed; unauthenticated routes
    -- (registration / login / forgot-password / verify-email)
    -- write a NULL user_id. The reference is intentionally
    -- ON DELETE SET NULL so erasure workflows don't have to cascade
    -- the access log (admins can keep the timeline intact while
    -- scrubbing user PII elsewhere).
    user_id      UUID         REFERENCES users(id) ON DELETE SET NULL,
    method       TEXT         NOT NULL,
    -- URI path only — query string is deliberately dropped to avoid
    -- accidentally logging tokens that some clients put there.
    path         TEXT         NOT NULL,
    status       SMALLINT     NOT NULL,
    latency_ms   INTEGER      NOT NULL,
    ip           INET,
    user_agent   TEXT,
    request_id   TEXT,
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX idx_access_logs_recent ON access_logs(created_at DESC);
CREATE INDEX idx_access_logs_user_recent
    ON access_logs(user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX idx_access_logs_path_recent ON access_logs(path, created_at DESC);
CREATE INDEX idx_access_logs_status_recent ON access_logs(status, created_at DESC);
CREATE INDEX idx_access_logs_ip_recent
    ON access_logs(ip, created_at DESC) WHERE ip IS NOT NULL;

CREATE TABLE access_logs_2026_05 PARTITION OF access_logs
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE access_logs_2026_06 PARTITION OF access_logs
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE access_logs_2026_07 PARTITION OF access_logs
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE access_logs_2026_08 PARTITION OF access_logs
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
