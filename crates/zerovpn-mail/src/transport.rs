use lettre::{
    AsyncSmtpTransport, Tokio1Executor,
    message::{Mailbox, Message, MultiPart},
    transport::smtp::{authentication::Credentials, client::Tls},
};
use thiserror::Error;
use tracing::info;

use crate::templates::Email;

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

impl Mailer {
    pub fn new(
        host: &str,
        port: u16,
        username: Option<&str>,
        password: Option<&str>,
        from: Mailbox,
        require_tls: bool,
    ) -> Result<Self, MailError> {
        // SMTP convention: 465 = implicit TLS (wrap the socket from byte 1,
        // lettre's `relay`), everything else with TLS required = STARTTLS
        // (begin plaintext, upgrade with the STARTTLS verb — lettre's
        // `starttls_relay`). Gmail / Outlook / most providers expose STARTTLS
        // on 587 and IMPLICIT on 465; picking the right one from the port
        // keeps the env config (just HOST/PORT) provider-agnostic.
        let mut builder = if require_tls {
            if port == 465 {
                AsyncSmtpTransport::<Tokio1Executor>::relay(host)?.port(port)
            } else {
                AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(host)?.port(port)
            }
        } else {
            AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(host)
                .port(port)
                .tls(Tls::None)
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
