-- Per-server WireGuard PersistentKeepalive (seconds).
--
-- Previously hardcoded to 30 in zerovpn-api (`PERSISTENT_KEEPALIVE`). Surfacing
-- it on the server row lets admins tune the keepalive cadence per region/hub —
-- e.g. raise it for high-NAT mobile carriers, lower it for low-power IoT
-- fleets. Existing peers keep the old value in their cached client `.conf`
-- until they re-download; live `wg set peer` calls (create/rotate/unpause/
-- reconnect) pick up the new value immediately for newly-added peers.
--
-- 0 disables keepalive (matches WireGuard semantics). The default mirrors the
-- previous hardcoded constant so the migration is value-preserving.

ALTER TABLE servers
    ADD COLUMN persistent_keepalive SMALLINT NOT NULL DEFAULT 30
        CHECK (persistent_keepalive >= 0 AND persistent_keepalive <= 3600);
