use askama::Template;

#[derive(Template)]
#[template(
    source = r#"Welcome to ZeroVPN!

Click the link below to verify your email address:

{{ link }}

This link expires in 24 hours. If you didn't sign up, ignore this email.

—
ZeroVPN
"#,
    ext = "txt",
    escape = "none"
)]
pub struct VerifyEmail<'a> {
    pub link: &'a str,
}

#[derive(Template)]
#[template(
    source = r#"Someone (hopefully you) requested a password reset on your ZeroVPN account.

Click the link below to choose a new password:

{{ link }}

This link expires in 1 hour. If you didn't request this, ignore the email — your existing password keeps working.

—
ZeroVPN
"#,
    ext = "txt",
    escape = "none"
)]
pub struct PasswordReset<'a> {
    pub link: &'a str,
}

#[derive(Template)]
#[template(
    source = r#"A new sign-in to your ZeroVPN account was just observed.

Time:  {{ when }}
Email: {{ email }}

If this was you, no action needed. If not, change your password now and review your active sessions:

{{ security_link }}

—
ZeroVPN
"#,
    ext = "txt",
    escape = "none"
)]
pub struct SuspiciousLogin<'a> {
    pub email: &'a str,
    pub when: &'a str,
    pub security_link: &'a str,
}
