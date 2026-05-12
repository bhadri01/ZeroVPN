-- Migration 11: per-user password-change watermark for session invalidation.
--
-- The password-reset and change-password flows used to issue an `UPDATE
-- sessions SET revoked_at = NOW()` against migration 1's `sessions` table.
-- That table isn't actually read by the running auth stack — tower-sessions'
-- PostgresStore keeps its rows in `tower_sessions` and the CurrentUser
-- extractor never consults the legacy table. Result: a successful password
-- reset did NOT actually log out existing browser sessions.
--
-- This migration adds a server-side watermark we can compare against on
-- every authenticated request:
--
--   * `password_changed_at` is set to NOW() on row creation
--   * Login snapshots the current value into the session row
--   * The auth extractor compares the snapshot vs the live column — any
--     mismatch kicks the session (it predates the most recent password
--     change, so it can't be trusted)
--   * Password reset / change-password bumps the column, killing every
--     outstanding session for the user in one round trip
--
-- Backfills existing rows to NOW() so all in-flight sessions are forced to
-- re-login once the new auth check ships (defensive). Idempotent.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
