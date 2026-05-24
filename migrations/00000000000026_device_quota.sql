-- Per-device monthly bandwidth quota — mirrors the per-account quota on
-- `users` (monthly_byte_cap / current_month_bytes / quota_resets_at) but scoped
-- to a single device, so an admin can cap one device independently of the
-- account-wide allowance. Enforcement pauses whichever scope hits its cap
-- first (device OR account); both reset on the same monthly boundary.
--
--   monthly_byte_cap   admin-set per-device cap in bytes. NULL/0 = no device cap
--                      (the account cap still applies).
--   current_month_bytes the device's own usage this cycle, maintained by the
--                      worker each poll tick and zeroed at the reset boundary.
--   quota_resets_at    first-of-next-month UTC; counter resets when NOW() passes
--                      it (matches users.quota_resets_at semantics).
--   auto_paused        TRUE when the quota sweep paused this device for being
--                      over a cap (device or account). Distinguishes a quota
--                      pause from a user's manual pause so the reset sweep only
--                      auto-resumes the ones it paused — manual pauses stay put.
ALTER TABLE devices
    ADD COLUMN monthly_byte_cap    BIGINT,
    ADD COLUMN current_month_bytes BIGINT      NOT NULL DEFAULT 0,
    ADD COLUMN quota_resets_at     TIMESTAMPTZ,
    ADD COLUMN auto_paused         BOOLEAN     NOT NULL DEFAULT FALSE;

-- The reset sweep scans for due windows and for auto-paused devices to restore;
-- a partial index keeps both scans cheap as the table grows.
CREATE INDEX idx_devices_quota_resets_at ON devices (quota_resets_at)
    WHERE quota_resets_at IS NOT NULL;
CREATE INDEX idx_devices_auto_paused ON devices (auto_paused)
    WHERE auto_paused = TRUE;
