//! Per-user UI preferences — settings the user sets via /app/settings
//! that we persist server-side so they sync across signed-in sessions.
//! Light/dark mode + accent stay client-local (localStorage) to avoid a
//! flash of wrong paint on first render; `theme` (visual variant) is
//! persisted server-side so it follows the user to new devices —
//! consistent with the rest of the prefs here.
//!
//! Defaults mirror the frontend's pre-settings behaviour, so a user who
//! never visits the page sees no change in how the app reads.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use utoipa::ToSchema;
use uuid::Uuid;

/// Full preference payload. Mirrors the `user_preferences` table 1:1
/// with the constraint-checked text columns surfaced as Rust enums on
/// the wire. Optional on partial PATCH-style updates; required on the
/// returned shape.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow, ToSchema)]
pub struct UserPreferences {
    /// One of `"bps" | "Bps"`
    pub units: String,
    /// One of `"iso" | "us" | "eu"`
    pub date_format: String,
    /// One of `"h24" | "h12"`
    pub time_format: String,
    pub reduced_motion: bool,
    /// One of `"dashboard" | "devices" | "topology"`
    pub default_landing: String,
    /// One of `"top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-center" | "bottom-right"`
    pub toast_position: String,
    pub toast_sound: bool,
    pub browser_notifications: bool,
    /// Send an email when a new WG device is added to the account.
    pub email_on_new_device: bool,
    /// Send an email when monthly bandwidth crosses 80% of the cap.
    pub email_on_quota_warning: bool,
    /// Send an email for security-relevant events: new-IP sign-in,
    /// password change, 2FA enabled/disabled, admin actions on the
    /// account. Default ON — opt out reduces signal during incidents.
    pub email_on_security_event: bool,
    /// Visual theme variant. One of `"swiss" | "brutalist" | "terminal"
    /// | "editorial" | "soft"`. Orthogonal to the client-local light/dark
    /// mode — each variant ships its own light + dark token set.
    pub theme: String,
}

impl Default for UserPreferences {
    fn default() -> Self {
        Self {
            units: "bps".into(),
            date_format: "iso".into(),
            time_format: "h24".into(),
            reduced_motion: false,
            default_landing: "dashboard".into(),
            toast_position: "bottom-right".into(),
            toast_sound: false,
            browser_notifications: false,
            email_on_new_device: true,
            email_on_quota_warning: true,
            email_on_security_event: true,
            theme: "swiss".into(),
        }
    }
}

/// Partial update — every field optional so PATCH-style writes don't
/// have to round-trip the full state. Server applies whatever's present
/// and leaves the rest alone.
#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct UserPreferencesPatch {
    pub units: Option<String>,
    pub date_format: Option<String>,
    pub time_format: Option<String>,
    pub reduced_motion: Option<bool>,
    pub default_landing: Option<String>,
    pub toast_position: Option<String>,
    pub toast_sound: Option<bool>,
    pub browser_notifications: Option<bool>,
    pub email_on_new_device: Option<bool>,
    pub email_on_quota_warning: Option<bool>,
    pub email_on_security_event: Option<bool>,
    pub theme: Option<String>,
}

/// Fetch the user's preferences. Returns defaults (without persisting)
/// for users who've never saved — the next save creates the row.
pub async fn get(pool: &PgPool, user_id: Uuid) -> sqlx::Result<UserPreferences> {
    let row: Option<UserPreferences> = sqlx::query_as(
        r#"SELECT units, date_format, time_format, reduced_motion,
                  default_landing, toast_position, toast_sound,
                  browser_notifications, email_on_new_device,
                  email_on_quota_warning, email_on_security_event,
                  theme
             FROM user_preferences
            WHERE user_id = $1"#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.unwrap_or_default())
}

/// Upsert the user's preferences with a partial patch. Fields not set in
/// `patch` keep the current row's value, or fall through to the Rust-side
/// `Default` (which mirrors the table defaults) for a brand-new row.
///
/// The previous version of this fn used `COALESCE($n, DEFAULT)` directly
/// in the SQL VALUES list. Postgres rejects that — `DEFAULT` is a magic
/// keyword that's only valid as the *whole* value of a column inside a
/// VALUES tuple, not as an argument to `COALESCE`. The fix is to merge
/// patch + current state in Rust and write only concrete values: no
/// `DEFAULT` keyword anywhere in the statement.
pub async fn upsert(
    pool: &PgPool,
    user_id: Uuid,
    patch: &UserPreferencesPatch,
) -> sqlx::Result<UserPreferences> {
    let mut merged = get(pool, user_id).await?;
    if let Some(v) = &patch.units {
        merged.units = v.clone();
    }
    if let Some(v) = &patch.date_format {
        merged.date_format = v.clone();
    }
    if let Some(v) = &patch.time_format {
        merged.time_format = v.clone();
    }
    if let Some(v) = patch.reduced_motion {
        merged.reduced_motion = v;
    }
    if let Some(v) = &patch.default_landing {
        merged.default_landing = v.clone();
    }
    if let Some(v) = &patch.toast_position {
        merged.toast_position = v.clone();
    }
    if let Some(v) = patch.toast_sound {
        merged.toast_sound = v;
    }
    if let Some(v) = patch.browser_notifications {
        merged.browser_notifications = v;
    }
    if let Some(v) = patch.email_on_new_device {
        merged.email_on_new_device = v;
    }
    if let Some(v) = patch.email_on_quota_warning {
        merged.email_on_quota_warning = v;
    }
    if let Some(v) = patch.email_on_security_event {
        merged.email_on_security_event = v;
    }
    if let Some(v) = &patch.theme {
        merged.theme = v.clone();
    }

    sqlx::query(
        r#"INSERT INTO user_preferences (
                user_id, units, date_format, time_format,
                reduced_motion, default_landing, toast_position,
                toast_sound, browser_notifications,
                email_on_new_device, email_on_quota_warning,
                email_on_security_event, theme, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
           ON CONFLICT (user_id) DO UPDATE SET
                units = EXCLUDED.units,
                date_format = EXCLUDED.date_format,
                time_format = EXCLUDED.time_format,
                reduced_motion = EXCLUDED.reduced_motion,
                default_landing = EXCLUDED.default_landing,
                toast_position = EXCLUDED.toast_position,
                toast_sound = EXCLUDED.toast_sound,
                browser_notifications = EXCLUDED.browser_notifications,
                email_on_new_device = EXCLUDED.email_on_new_device,
                email_on_quota_warning = EXCLUDED.email_on_quota_warning,
                email_on_security_event = EXCLUDED.email_on_security_event,
                theme = EXCLUDED.theme,
                updated_at = NOW()"#,
    )
    .bind(user_id)
    .bind(&merged.units)
    .bind(&merged.date_format)
    .bind(&merged.time_format)
    .bind(merged.reduced_motion)
    .bind(&merged.default_landing)
    .bind(&merged.toast_position)
    .bind(merged.toast_sound)
    .bind(merged.browser_notifications)
    .bind(merged.email_on_new_device)
    .bind(merged.email_on_quota_warning)
    .bind(merged.email_on_security_event)
    .bind(&merged.theme)
    .execute(pool)
    .await?;
    Ok(merged)
}
