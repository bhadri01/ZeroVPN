-- Phase 2 / Stage B — schema cleanup. Retire the misleading
-- `*.ip_prefix` column names: Stage A made these columns store the
-- full client address (`/32` for v4, `/128` for v6) instead of the
-- previous `/24` / `/48` truncated prefix, so the "prefix" suffix is
-- now actively wrong. This migration renames them to plain `ip`
-- everywhere and renames the matching `users.last_login_ip_prefix`
-- column too.
--
-- The Rust struct fields, repo helper names, and frontend types are
-- swept in the same commit so JSON over the wire and field names in
-- code all line up with the new column names.
--
-- Postgres column renames are metadata-only (no table lock held more
-- than microseconds, no row rewrite) so this is operationally cheap
-- — only the application has to be redeployed against the new names.
--
-- Indexes that referenced the old column names follow the rename
-- automatically — Postgres tracks them by column OID, not by name.
--
-- See TODO.md → "Phase 2 / Stage B" → "Schema-cleanup migration".

ALTER TABLE audit_logs    RENAME COLUMN ip_prefix            TO ip;
ALTER TABLE failed_logins RENAME COLUMN ip_prefix            TO ip;
ALTER TABLE users         RENAME COLUMN last_login_ip_prefix TO last_login_ip;
