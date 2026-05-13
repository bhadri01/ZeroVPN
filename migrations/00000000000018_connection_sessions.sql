-- Phase 2 / Stage B — session-shaped connection log.
--
-- The WG poller already writes `device.online` / `device.offline` audit
-- rows on transition. This table promotes them to a typed
-- per-connection-*session* shape: one row per WG connection, with
-- `started_at` / `ended_at` and snapshot byte counters so admins can
-- ask "show me this device's last 10 connections with duration and
-- bytes per session" in a single SELECT — no JOIN-and-pair-up over
-- transition pairs.
--
-- Lifecycle:
--   - online transition  → INSERT a row, `ended_at = NULL` (open session)
--   - offline transition → UPDATE the device's most recent open row
--   - worker restart     → all open rows get `ended_at = NOW()` swept by
--                          a startup pass (the in-memory `prev_online`
--                          map doesn't survive restarts and the WG
--                          counter rx/tx_total values reset, so the
--                          previously-captured `rx_bytes_at_start`
--                          baseline is no longer comparable).
--
-- See TODO.md → "Phase 2 / Stage B" → "Connection events table".

CREATE TABLE connection_sessions (
    id                       BIGSERIAL    PRIMARY KEY,
    device_id                UUID         NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    user_id                  UUID         NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    -- Open-session timeline.
    started_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    ended_at                 TIMESTAMPTZ,
    -- Endpoint at the start of the session, and at end (in case the
    -- peer's NAT/mobile network changed mid-session — surfaces as a
    -- mismatch in the admin UI).
    peer_endpoint_at_start   TEXT,
    peer_endpoint_at_end     TEXT,
    -- WG's per-peer cumulative rx/tx counters snapshotted at start and
    -- end. The session's delivered bytes is `end - start` per axis.
    -- NULL on the end side means the session is still open OR was swept
    -- closed by the startup pass without observing a clean offline
    -- transition.
    rx_bytes_at_start        BIGINT       NOT NULL DEFAULT 0,
    tx_bytes_at_start        BIGINT       NOT NULL DEFAULT 0,
    rx_bytes_at_end          BIGINT,
    tx_bytes_at_end          BIGINT
);

-- Per-device timeline (newest first) — admin connection-history dialog.
CREATE INDEX idx_connection_sessions_device_recent
    ON connection_sessions(device_id, started_at DESC);

-- Per-user timeline for the unified-activity feed.
CREATE INDEX idx_connection_sessions_user_recent
    ON connection_sessions(user_id, started_at DESC);

-- Open-sessions lookup — used by `close_session` (most recent open row
-- for a device) and by the worker-startup sweep.
CREATE INDEX idx_connection_sessions_open
    ON connection_sessions(device_id, started_at DESC)
    WHERE ended_at IS NULL;
