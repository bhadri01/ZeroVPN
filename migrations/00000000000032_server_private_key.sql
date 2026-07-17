-- Store the WireGuard *server* private key in the DB (KEK-encrypted), so the
-- api is stateless and the `wg_config` volume becomes a derived cache. On boot
-- the api restores `wg0.conf` from this column; a lost/wiped `wg_config` volume
-- no longer means a lost (or silently rotated) server key. Nullable so rows
-- created before this migration backfill on the next boot — the api reads the
-- key from the live `wg0.conf` and stores it here.
ALTER TABLE servers
    ADD COLUMN private_key_encrypted BYTEA;
