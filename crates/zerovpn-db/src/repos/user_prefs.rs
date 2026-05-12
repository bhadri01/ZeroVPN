//! Per-user UI preferences — settings the user sets via /app/settings
//! that we persist server-side so they sync across signed-in sessions.
//! Theme + accent stay client-local (localStorage) to avoid a flash of
//! wrong paint on first render; everything in here can be fetched after
//! mount without visible disruption.
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
}

/// Fetch the user's preferences. Returns defaults (without persisting)
/// for users who've never saved — the next save creates the row.
pub async fn get(pool: &PgPool, user_id: Uuid) -> sqlx::Result<UserPreferences> {
    let row: Option<UserPreferences> = sqlx::query_as(
        r#"SELECT units, date_format, time_format, reduced_motion,
                  default_landing, toast_position, toast_sound,
                  browser_notifications
             FROM user_preferences
            WHERE user_id = $1"#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.unwrap_or_default())
}

/// Upsert the user's preferences with a partial patch. Anything not
/// present in `patch` falls through to the current row value (or to the
/// table default for a brand-new row).
pub async fn upsert(
    pool: &PgPool,
    user_id: Uuid,
    patch: &UserPreferencesPatch,
) -> sqlx::Result<UserPreferences> {
    // Single statement: INSERT a row using each provided field (else
    // DEFAULT), and ON CONFLICT update only the columns the patch
    // specifies via COALESCE-style "use the new value when not null".
    sqlx::query(
        r#"INSERT INTO user_preferences (
                user_id, units, date_format, time_format,
                reduced_motion, default_landing, toast_position,
                toast_sound, browser_notifications, updated_at
           ) VALUES (
                $1,
                COALESCE($2, DEFAULT),
                COALESCE($3, DEFAULT),
                COALESCE($4, DEFAULT),
                COALESCE($5, DEFAULT),
                COALESCE($6, DEFAULT),
                COALESCE($7, DEFAULT),
                COALESCE($8, DEFAULT),
                COALESCE($9, DEFAULT),
                NOW()
           )
           ON CONFLICT (user_id) DO UPDATE SET
                units = COALESCE(EXCLUDED.units, user_preferences.units),
                date_format = COALESCE(EXCLUDED.date_format, user_preferences.date_format),
                time_format = COALESCE(EXCLUDED.time_format, user_preferences.time_format),
                reduced_motion = COALESCE(EXCLUDED.reduced_motion, user_preferences.reduced_motion),
                default_landing = COALESCE(EXCLUDED.default_landing, user_preferences.default_landing),
                toast_position = COALESCE(EXCLUDED.toast_position, user_preferences.toast_position),
                toast_sound = COALESCE(EXCLUDED.toast_sound, user_preferences.toast_sound),
                browser_notifications = COALESCE(EXCLUDED.browser_notifications, user_preferences.browser_notifications),
                updated_at = NOW()"#,
    )
    .bind(user_id)
    .bind(&patch.units)
    .bind(&patch.date_format)
    .bind(&patch.time_format)
    .bind(patch.reduced_motion)
    .bind(&patch.default_landing)
    .bind(&patch.toast_position)
    .bind(patch.toast_sound)
    .bind(patch.browser_notifications)
    .execute(pool)
    .await?;
    get(pool, user_id).await
}
