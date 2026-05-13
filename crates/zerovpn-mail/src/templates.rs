//! Transactional email templates.
//!
//! Each email type is defined by a public input struct and a paired
//! `impl Email`. The struct carries the runtime data (URLs, names,
//! timestamps); the trait turns it into a tuple of (subject, html, text)
//! ready for [`crate::Mailer::send_email`].
//!
//! ## Design system
//! HTML templates extend `base.html`, which provides:
//!   • wordmark header, eyebrow, title, content slot, footer
//!   • mobile + dark-mode media queries (`<style>` block in <head>)
//!   • bulletproof button + tinted alert + key/value list macros in
//!     `_components.html`
//!
//! Plain-text counterparts live in `.txt` siblings — each email ships
//! both, wrapped in a `multipart/alternative` MIME container so every
//! client picks the best fit.
//!
//! ## Adding a new email
//!   1. Drop `<name>.html` + `<name>.txt` into `templates/`.
//!   2. Add a pair of `#[derive(Template)]` types (one per variant) and
//!      a public input struct that fans into both.
//!   3. Implement [`Email`] on the input struct.

use askama::Template;

/// Render contract every email type implements. Returns the rendered
/// `(subject, html, text)` triple that [`crate::Mailer::send_email`]
/// drops directly into a multipart MIME body.
pub trait Email {
    fn subject(&self) -> &'static str;
    fn render_html(&self) -> Result<String, askama::Error>;
    fn render_text(&self) -> Result<String, askama::Error>;
}

// ── Verify email ─────────────────────────────────────────────────────────

pub struct VerifyEmail<'a> {
    pub link: &'a str,
}

#[derive(Template)]
#[template(path = "verify_email.html", escape = "html")]
struct VerifyEmailHtml<'a> {
    link: &'a str,
}

#[derive(Template)]
#[template(path = "verify_email.txt", escape = "none")]
struct VerifyEmailText<'a> {
    link: &'a str,
}

impl Email for VerifyEmail<'_> {
    fn subject(&self) -> &'static str {
        "Verify your ZeroVPN email"
    }
    fn render_html(&self) -> Result<String, askama::Error> {
        VerifyEmailHtml { link: self.link }.render()
    }
    fn render_text(&self) -> Result<String, askama::Error> {
        VerifyEmailText { link: self.link }.render()
    }
}

// ── Password reset ───────────────────────────────────────────────────────

pub struct PasswordReset<'a> {
    pub link: &'a str,
}

#[derive(Template)]
#[template(path = "password_reset.html", escape = "html")]
struct PasswordResetHtml<'a> {
    link: &'a str,
}

#[derive(Template)]
#[template(path = "password_reset.txt", escape = "none")]
struct PasswordResetText<'a> {
    link: &'a str,
}

impl Email for PasswordReset<'_> {
    fn subject(&self) -> &'static str {
        "Reset your ZeroVPN password"
    }
    fn render_html(&self) -> Result<String, askama::Error> {
        PasswordResetHtml { link: self.link }.render()
    }
    fn render_text(&self) -> Result<String, askama::Error> {
        PasswordResetText { link: self.link }.render()
    }
}

// ── Suspicious / new-IP sign-in ──────────────────────────────────────────

pub struct SuspiciousLogin<'a> {
    pub email: &'a str,
    pub when: &'a str,
    pub security_link: &'a str,
    /// Optional client IP, displayed verbatim if present. Pass the full
    /// address now that the prefix-truncation has been removed upstream.
    pub ip: Option<&'a str>,
    /// Optional user-agent string, useful for spotting unfamiliar
    /// browsers / curl-style tooling in the alert.
    pub user_agent: Option<&'a str>,
}

#[derive(Template)]
#[template(path = "suspicious_login.html", escape = "html")]
struct SuspiciousLoginHtml<'a> {
    email: &'a str,
    when: &'a str,
    security_link: &'a str,
    ip: Option<&'a str>,
    user_agent: Option<&'a str>,
}

#[derive(Template)]
#[template(path = "suspicious_login.txt", escape = "none")]
struct SuspiciousLoginText<'a> {
    email: &'a str,
    when: &'a str,
    security_link: &'a str,
    ip: Option<&'a str>,
    user_agent: Option<&'a str>,
}

impl Email for SuspiciousLogin<'_> {
    fn subject(&self) -> &'static str {
        "New sign-in to your ZeroVPN account"
    }
    fn render_html(&self) -> Result<String, askama::Error> {
        SuspiciousLoginHtml {
            email: self.email,
            when: self.when,
            security_link: self.security_link,
            ip: self.ip,
            user_agent: self.user_agent,
        }
        .render()
    }
    fn render_text(&self) -> Result<String, askama::Error> {
        SuspiciousLoginText {
            email: self.email,
            when: self.when,
            security_link: self.security_link,
            ip: self.ip,
            user_agent: self.user_agent,
        }
        .render()
    }
}

// ── New device ──────────────────────────────────────────────────────────

pub struct NewDevice<'a> {
    pub email: &'a str,
    pub device_name: &'a str,
    pub device_os: Option<&'a str>,
    pub when: &'a str,
    pub manage_link: &'a str,
}

#[derive(Template)]
#[template(path = "new_device.html", escape = "html")]
struct NewDeviceHtml<'a> {
    email: &'a str,
    device_name: &'a str,
    device_os: Option<&'a str>,
    when: &'a str,
    manage_link: &'a str,
}

#[derive(Template)]
#[template(path = "new_device.txt", escape = "none")]
struct NewDeviceText<'a> {
    email: &'a str,
    device_name: &'a str,
    device_os: Option<&'a str>,
    when: &'a str,
    manage_link: &'a str,
}

impl Email for NewDevice<'_> {
    fn subject(&self) -> &'static str {
        "New device added to your ZeroVPN account"
    }
    fn render_html(&self) -> Result<String, askama::Error> {
        NewDeviceHtml {
            email: self.email,
            device_name: self.device_name,
            device_os: self.device_os,
            when: self.when,
            manage_link: self.manage_link,
        }
        .render()
    }
    fn render_text(&self) -> Result<String, askama::Error> {
        NewDeviceText {
            email: self.email,
            device_name: self.device_name,
            device_os: self.device_os,
            when: self.when,
            manage_link: self.manage_link,
        }
        .render()
    }
}

// ── Quota warning ───────────────────────────────────────────────────────

pub struct QuotaWarning<'a> {
    /// Integer percent (0..=100). Drives the progress-bar width AND the
    /// CSS bar tone (green / amber / red) in the HTML variant.
    pub used_pct: u32,
    /// Pre-formatted ("12.4 GB"). The mail crate intentionally doesn't
    /// pull `lib/units.ts` parity into Rust — callers format.
    pub used_human: &'a str,
    pub cap_human: &'a str,
    /// Pre-formatted label like "82%". Distinct from `used_pct` so the
    /// rendered text can include the % glyph without doing the math in
    /// the template (some terminals strip combining marks oddly).
    pub used_pct_label: &'a str,
    pub resets_at: &'a str,
}

#[derive(Template)]
#[template(path = "quota_warning.html", escape = "html")]
struct QuotaWarningHtml<'a> {
    used_pct: u32,
    used_human: &'a str,
    cap_human: &'a str,
    used_pct_label: &'a str,
    resets_at: &'a str,
}

#[derive(Template)]
#[template(path = "quota_warning.txt", escape = "none")]
struct QuotaWarningText<'a> {
    used_human: &'a str,
    cap_human: &'a str,
    used_pct_label: &'a str,
    resets_at: &'a str,
}

impl Email for QuotaWarning<'_> {
    fn subject(&self) -> &'static str {
        "You're approaching your ZeroVPN bandwidth cap"
    }
    fn render_html(&self) -> Result<String, askama::Error> {
        QuotaWarningHtml {
            used_pct: self.used_pct,
            used_human: self.used_human,
            cap_human: self.cap_human,
            used_pct_label: self.used_pct_label,
            resets_at: self.resets_at,
        }
        .render()
    }
    fn render_text(&self) -> Result<String, askama::Error> {
        QuotaWarningText {
            used_human: self.used_human,
            cap_human: self.cap_human,
            used_pct_label: self.used_pct_label,
            resets_at: self.resets_at,
        }
        .render()
    }
}

// ── Admin action / security event ───────────────────────────────────────

/// Generic "something happened to your account" notification. The
/// action_label drives the title; the detail paragraph supplies context.
pub struct AdminAction<'a> {
    pub action_label: &'a str,
    pub detail: &'a str,
    pub email: &'a str,
    pub when: &'a str,
    pub admin_email: Option<&'a str>,
    pub security_link: &'a str,
}

#[derive(Template)]
#[template(path = "admin_action.html", escape = "html")]
struct AdminActionHtml<'a> {
    action_label: &'a str,
    detail: &'a str,
    email: &'a str,
    when: &'a str,
    admin_email: Option<&'a str>,
    security_link: &'a str,
}

#[derive(Template)]
#[template(path = "admin_action.txt", escape = "none")]
struct AdminActionText<'a> {
    action_label: &'a str,
    detail: &'a str,
    email: &'a str,
    when: &'a str,
    admin_email: Option<&'a str>,
    security_link: &'a str,
}

impl Email for AdminAction<'_> {
    fn subject(&self) -> &'static str {
        "A change was made to your ZeroVPN account"
    }
    fn render_html(&self) -> Result<String, askama::Error> {
        AdminActionHtml {
            action_label: self.action_label,
            detail: self.detail,
            email: self.email,
            when: self.when,
            admin_email: self.admin_email,
            security_link: self.security_link,
        }
        .render()
    }
    fn render_text(&self) -> Result<String, askama::Error> {
        AdminActionText {
            action_label: self.action_label,
            detail: self.detail,
            email: self.email,
            when: self.when,
            admin_email: self.admin_email,
            security_link: self.security_link,
        }
        .render()
    }
}
