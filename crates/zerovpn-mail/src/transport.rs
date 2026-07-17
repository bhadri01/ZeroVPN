use lettre::{
    AsyncSmtpTransport, Tokio1Executor,
    message::{Mailbox, Message, MultiPart},
    transport::smtp::{
        authentication::Credentials,
        client::{Tls, TlsParameters},
    },
};
use thiserror::Error;
use tracing::info;

use crate::templates::Email;

/// How the SMTP connection is secured, chosen explicitly from `.env`
/// (`ZEROVPN_SMTP__SSL_TLS` / `ZEROVPN_SMTP__STARTTLS`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SmtpEncryption {
    /// Plaintext, no TLS. Dev/MailHog only.
    None,
    /// Begin plaintext, upgrade with the STARTTLS verb (usually port 587).
    StartTls,
    /// Implicit TLS — the socket is wrapped from byte 1, SMTPS (usually 465).
    Ssl,
}

#[derive(Debug, Error)]
pub enum MailError {
    #[error("smtp: {0}")]
    Smtp(#[from] lettre::transport::smtp::Error),
    #[error("build: {0}")]
    Build(String),
    #[error("render: {0}")]
    Render(#[from] askama::Error),
}

#[derive(Clone)]
pub struct Mailer {
    transport: AsyncSmtpTransport<Tokio1Executor>,
    from: Mailbox,
}

/// TLS parameters for the given host. When `validate_certs` is false the peer
/// certificate and hostname are NOT checked — an explicit, dangerous opt-out
/// for internal relays with self-signed certs; never use it against a public
/// relay.
fn tls_params(host: &str, validate_certs: bool) -> Result<TlsParameters, MailError> {
    Ok(TlsParameters::builder(host.to_string())
        .dangerous_accept_invalid_certs(!validate_certs)
        .dangerous_accept_invalid_hostnames(!validate_certs)
        .build()?)
}

impl Mailer {
    /// Build the transport from explicit settings. `encryption` picks the TLS
    /// mode; `validate_certs` verifies the server certificate (keep `true`; pass
    /// `false` only for an internal relay with a self-signed cert). Auth is
    /// enabled whenever both `username` and `password` are supplied.
    pub fn new(
        host: &str,
        port: u16,
        username: Option<&str>,
        password: Option<&str>,
        from: Mailbox,
        encryption: SmtpEncryption,
        validate_certs: bool,
    ) -> Result<Self, MailError> {
        // `builder_dangerous` = plaintext socket to start; the `.tls(...)` below
        // decides how (if at all) it's secured. `Tls::Wrapper` = implicit TLS
        // (SMTPS), `Tls::Required` = STARTTLS-or-fail, `Tls::None` = plaintext.
        let mut builder = AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(host).port(port);
        builder = match encryption {
            SmtpEncryption::None => builder.tls(Tls::None),
            SmtpEncryption::Ssl => builder.tls(Tls::Wrapper(tls_params(host, validate_certs)?)),
            SmtpEncryption::StartTls => {
                builder.tls(Tls::Required(tls_params(host, validate_certs)?))
            }
        };

        if let (Some(u), Some(p)) = (username, password) {
            builder = builder.credentials(Credentials::new(u.to_string(), p.to_string()));
        }
        let transport = builder.build();
        Ok(Self { transport, from })
    }

    /// Preferred API: ship a typed [`Email`] as `multipart/alternative`
    /// (plain text + HTML). Clients pick the variant they can render;
    /// plain-text-only readers (mutt, terminal pipes) see clean ASCII,
    /// rich clients see the styled HTML. Both parts are produced from
    /// the same struct so they can't drift apart.
    pub async fn send_email<E: Email>(
        &self,
        to: Mailbox,
        email: &E,
    ) -> Result<(), MailError> {
        let text = email.render_text()?;
        let html = email.render_html()?;
        self.send_rendered(to, email.subject().to_string(), text, html).await
    }

    /// Same shape as [`Self::send_email`] but takes the already-rendered
    /// strings. Callers that need to fire the send from a `tokio::spawn`
    /// (e.g. the login flow's suspicious-IP alert, which mustn't block
    /// the login response) render against borrowed data first and pass
    /// the owned `String`s into the spawned future.
    pub async fn send_rendered(
        &self,
        to: Mailbox,
        subject: String,
        text: String,
        html: String,
    ) -> Result<(), MailError> {
        let msg = Message::builder()
            .from(self.from.clone())
            .to(to.clone())
            .subject(&subject)
            .multipart(MultiPart::alternative_plain_html(text, html))
            .map_err(|e| MailError::Build(e.to_string()))?;
        let _ = lettre::AsyncTransport::send(&self.transport, msg).await?;
        info!(?to, %subject, "mail sent (multipart)");
        Ok(())
    }
}
