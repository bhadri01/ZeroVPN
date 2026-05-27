-- Global non-admin user policy: hide the per-device detail page.
--
-- First entry in what is intended to grow into a small set of admin-set
-- policy flags ("non-admin users can/can't do X"). Stored on the existing
-- `app_settings` singleton next to maintenance_mode so the API can read
-- every global toggle in one row.
--
-- When ON, the user app (1) hides "View details" affordances on the device
-- cards/list and (2) bounces non-admins back to /app/devices if they navigate
-- directly to /app/devices/{id}. Admins (and impersonating admins) are not
-- gated — they can still inspect any device. This is a frontend policy gate,
-- not a backend authz boundary: the per-device API endpoints themselves stay
-- reachable so the device list, connect/pause, and config download keep
-- working.

ALTER TABLE app_settings
    ADD COLUMN policy_hide_device_detail BOOLEAN NOT NULL DEFAULT FALSE;
