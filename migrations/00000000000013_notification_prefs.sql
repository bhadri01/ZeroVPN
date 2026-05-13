-- Migration 13: notification preferences on user_preferences.
--
-- Adds opt-in/opt-out toggles for transactional emails. Defaults err on
-- the side of "tell the user" for security-relevant events (TRUE) and
-- "stay quiet" for noisier ones (TRUE for new-device, FALSE for marketing
-- noise — which we don't have any of yet).
--
-- These columns are read by the email-issuing helpers next to the
-- existing per-event flows (suspicious-login, device-added, quota cap).

ALTER TABLE user_preferences
    ADD COLUMN IF NOT EXISTS email_on_new_device      BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS email_on_quota_warning   BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS email_on_security_event  BOOLEAN NOT NULL DEFAULT TRUE;
