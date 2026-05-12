-- Migration 7: per-user device sort order.
--
-- Adds `display_order` so the user can drag-reorder their devices in the
-- UI and have that arrangement persist server-side (visible to every
-- session / device they sign in from). The frontend bulk-reassigns
-- consecutive integers on reorder; nullable here so existing rows fall
-- through to created_at-desc until the user touches them.
--
-- We index `(user_id, display_order NULLS LAST, created_at DESC)` so the
-- list query stays cheap even with hundreds of devices per user.

ALTER TABLE devices
    ADD COLUMN display_order INTEGER;

CREATE INDEX devices_user_order_idx
    ON devices (user_id, display_order NULLS LAST, created_at DESC);
