-- Phase 2 / Stage B — session events table.
--
-- One row per account-security-relevant action: login, logout, idle
-- timeout, suspicious-login transition, password change, 2FA toggle,
-- impersonation start/stop. Conceptually overlaps the audit log — and
-- many of these spots *already* write an audit row — but session_events
-- is a typed, narrow shape so admins can filter and paginate it
-- cheaply without dragging in every device.config_changed and
-- admin.user_quota_set row.
--
-- The two tables coexist by design: audit_logs is the everything-bucket
-- (any state change, any actor), session_events is the per-user
-- account-security feed (one user, narrow event vocabulary, ordered
-- with the user's experience). Surfaced as /admin/sessions; a per-user
-- panel on /admin/users/{id} drops in for free since the row shape is
-- already user-scoped.
--
-- See TODO.md → "Phase 2 / Stage B" and CHANGELOG.md for the full plan.

CREATE TYPE session_event_kind AS ENUM (
    'login',
    'logout',
    'idle_timeout',
    'suspicious_login',
    'password_change',
    'totp_enable',
    'totp_disable',
    'impersonation_start',
    'impersonation_end'
);

CREATE TABLE session_events (
    id          BIGSERIAL           PRIMARY KEY,
    user_id     UUID                NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event       session_event_kind  NOT NULL,
    ip          INET,
    user_agent  TEXT,
    -- Free-form for event-specific context: previous IP for
    -- suspicious_login, password-change provenance ("settings" /
    -- "email_link" / "force_reset"), the target user_id for
    -- impersonation_*. Empty object by default so consumers don't
    -- have to null-check.
    metadata    JSONB               NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

-- Per-user timeline (newest first) — feeds the per-user panel on the
-- admin user-detail page.
CREATE INDEX idx_session_events_user_recent
    ON session_events(user_id, created_at DESC);

-- Cross-user filter by event kind (newest first) — feeds the admin
-- sessions list when an admin filters on, say, every impersonation
-- start across the fleet.
CREATE INDEX idx_session_events_event_recent
    ON session_events(event, created_at DESC);

-- Cross-user filter by IP (newest first) — answers "which accounts
-- have ever signed in from this address?". Stage B's Finder integration
-- will use this.
CREATE INDEX idx_session_events_ip_recent
    ON session_events(ip, created_at DESC);
