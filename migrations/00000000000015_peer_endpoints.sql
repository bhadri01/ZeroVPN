-- Phase 2 / Stage A — capture WireGuard peer endpoints.
--
-- The `wg show <iface> dump` parser in zerovpn-worker historically
-- skipped the endpoint column (cols[1] — the public "ip:port" the peer
-- last connected from). With the full-logging policy that visibility is
-- now wanted. Two-tier storage:
--
--   `devices.last_peer_endpoint`     — most recent observation, for the
--                                       admin device-detail "current"
--                                       view. Updated in place on every
--                                       change.
--   `peer_endpoint_history`          — append-only log of every distinct
--                                       endpoint observed for the device,
--                                       so admins can answer "which IPs
--                                       has this device used?" without
--                                       drowning in per-poll duplicates.
--
-- Stored as TEXT (not INET) because WG endpoints carry a port and IPv6
-- endpoints arrive in bracket form ("[2001:db8::1]:51820"); a TEXT
-- column round-trips both. A future migration may split this into
-- (host INET, port INT4) once the admin filtering UI demands it.
--
-- See CHANGELOG.md → "Policy reversal — full logging system" and
-- TODO.md → "Phase 2 / Stage A".

ALTER TABLE devices ADD COLUMN last_peer_endpoint    TEXT;
ALTER TABLE devices ADD COLUMN last_peer_endpoint_at TIMESTAMPTZ;

CREATE TABLE peer_endpoint_history (
    id          BIGSERIAL    PRIMARY KEY,
    device_id   UUID         NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    endpoint    TEXT         NOT NULL,
    observed_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Newest-first lookup per device (powers the device-detail timeline).
CREATE INDEX idx_peer_endpoint_history_device_recent
    ON peer_endpoint_history(device_id, observed_at DESC);
-- Allow "which devices have ever connected from this endpoint?" queries
-- (the kind of admin investigation that motivated the policy change).
CREATE INDEX idx_peer_endpoint_history_endpoint
    ON peer_endpoint_history(endpoint, observed_at DESC);
