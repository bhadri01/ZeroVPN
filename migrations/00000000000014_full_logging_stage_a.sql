-- Phase 2 / Stage A — "Full logging system" policy reversal, first chunk.
--
-- The previous policy stored user-agent strings as SHA-256 hashes (TEXT
-- column with `_hash` suffix) and truncated client IPs to /24-prefix
-- networks. Both decisions were privacy-preserving but they're being
-- reversed: admins should be able to see who attempted to log in, from
-- what IP, with what client. This migration renames the misleading
-- "_hash" columns to plain `user_agent` so the application layer can
-- write plaintext values into them. The column type is unchanged (TEXT)
-- — only the contract changes.
--
-- The IP-prefix columns (`failed_logins.ip_prefix`, `audit_logs.ip_prefix`,
-- `sessions.ip_prefix`, `users.last_login_ip_prefix`) are left in place
-- with their current names; the type is INET so they already accept full
-- host addresses (/32 v4, /128 v6). The column name is now semantically
-- misleading — we could `RENAME COLUMN` here too, but doing so cascades
-- through every `query_as!` / `FromRow` site and dwarfs the actual
-- behavioural change. Rename pass is queued for the schema-cleanup
-- migration that ships alongside the access-log additions in Stage B.
--
-- See CHANGELOG.md → "Policy reversal — full logging system (2026-05-13)"
-- and TODO.md → "Phase 2 — Full logging system" for the full plan.

ALTER TABLE failed_logins RENAME COLUMN user_agent_hash TO user_agent;
ALTER TABLE sessions      RENAME COLUMN user_agent_hash TO user_agent;
