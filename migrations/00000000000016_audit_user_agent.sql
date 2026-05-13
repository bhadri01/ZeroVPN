-- Phase 2 / Stage A — capture User-Agent on audit rows.
--
-- The auth flows (register, login, password change, suspicious-login
-- transition) now have the request's `User-Agent` header in scope and
-- want to persist it alongside the audit row. Rather than sweep every
-- one of the ~33 existing `AuditEntry { ... }` literals to add a 7th
-- field, the new column is populated through a parallel
-- `audit::record_with_ua(...)` helper. Existing call sites continue to
-- use `audit::record(...)` which writes NULL into this column — no
-- silent data loss, just a gradual rollout as routes are migrated to
-- pass UA.
--
-- See CHANGELOG.md → "Policy reversal — full logging system" and
-- TODO.md → "Phase 2 / Stage A".

ALTER TABLE audit_logs ADD COLUMN user_agent TEXT;
