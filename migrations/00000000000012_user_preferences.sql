-- Migration 12: per-user UI preferences.
--
-- Backs the settings page's Preferences / Notifications / Appearance
-- (server-persisted) sections so a user's choices sync across every
-- signed-in session. Themes + accent stay client-local in localStorage
-- to avoid a flash-of-wrong-paint on first paint; everything below is
-- safe to fetch after mount.
--
-- One row per user. `updated_at` lets us implement future "last changed"
-- displays. Defaults match the current frontend behaviour so existing
-- users get sensible values without an explicit save.

CREATE TABLE user_preferences (
    user_id              UUID         PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    units                TEXT         NOT NULL DEFAULT 'bps'
                                       CHECK (units IN ('bps', 'Bps')),
    date_format          TEXT         NOT NULL DEFAULT 'iso'
                                       CHECK (date_format IN ('iso', 'us', 'eu')),
    time_format          TEXT         NOT NULL DEFAULT 'h24'
                                       CHECK (time_format IN ('h24', 'h12')),
    reduced_motion       BOOLEAN      NOT NULL DEFAULT FALSE,
    default_landing      TEXT         NOT NULL DEFAULT 'dashboard'
                                       CHECK (default_landing IN ('dashboard', 'devices', 'topology')),
    toast_position       TEXT         NOT NULL DEFAULT 'bottom-right'
                                       CHECK (toast_position IN (
                                           'top-left', 'top-center', 'top-right',
                                           'bottom-left', 'bottom-center', 'bottom-right'
                                       )),
    toast_sound          BOOLEAN      NOT NULL DEFAULT FALSE,
    browser_notifications BOOLEAN     NOT NULL DEFAULT FALSE,
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
