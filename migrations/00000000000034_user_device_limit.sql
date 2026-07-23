-- Per-user cap on how many active (non-revoked) devices/peers a user may
-- create. Admin-settable from the user-detail page. Defaults to 5 — the value
-- of the previously-hardcoded MAX_DEVICES_PER_USER — so every existing user is
-- unaffected and the enforcement simply reads this column instead of a const.
ALTER TABLE users ADD COLUMN device_limit INTEGER NOT NULL DEFAULT 5;
