-- Device form-factor "type", complementary to `os` (e.g. an Android tablet is
-- os='android' + device_type='tablet'). Nullable-safe via a default so the
-- column adds cleanly to existing rows.
CREATE TYPE device_type AS ENUM (
    'phone', 'tablet', 'laptop', 'desktop', 'tv', 'router', 'watch', 'iot', 'server', 'other'
);

ALTER TABLE devices
    ADD COLUMN device_type device_type NOT NULL DEFAULT 'other';
