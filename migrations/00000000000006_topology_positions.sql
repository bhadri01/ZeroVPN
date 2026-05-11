-- Migration 6: per-user saved topology layout.
--
-- Persists the (x, y) overrides set by the live-topology drag UI so a
-- user's arrangement survives refresh AND syncs across devices. Keyed by
-- (user_id, node_id) where node_id is either a device UUID string or the
-- literal sentinel "__hub__".
--
-- Stale rows: when a user deletes a device, its topology_positions row
-- becomes orphaned (node_id is TEXT, not a real FK to devices(id)). The
-- frontend ignores positions for unknown device IDs, so the orphan is
-- functionally dormant; we don't bother purging on every device delete.

CREATE TABLE topology_positions (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    x DOUBLE PRECISION NOT NULL,
    y DOUBLE PRECISION NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, node_id)
);
