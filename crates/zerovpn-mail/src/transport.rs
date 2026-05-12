use lettre::{
    AsyncSmtpTransport, Tokio1Executor,
    message::{
        Mailbox, Message, SinglePart,
        header::{ContentTransferEncoding, ContentType},
    },
    transport::smtp::{authentication::Credentials, client::Tls},
};
use thiserror::Error;
use tracing::info;

#[derive(Debug, Error)]
pub enum MailError {
    #[error("smtp: {0}")]
    Smtp(#[from] lettre::transport::smtp::Error),
    #[error("build: {0}")]
    Build(String),
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
        let mut builder = if require_tls {
            AsyncSmtpTransport::<Tokio1Executor>::relay(host)?.port(port)
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

    pub async fn send(&self, to: Mailbox, subject: &str, body: String) -> Result<(), MailError> {
        // Force base64 transfer encoding. lettre's default `.body()` falls
        // back to quoted-printable when the body has any non-ASCII byte
        // (e.g. an em-dash in our templates). QP encodes `=` as `=3D` and
        // soft-wraps lines at 76 cols mid-string — both of which corrupt
        // the verify/reset URLs we embed. Base64 is universally decoded
        // by every modern MUA and never fragments URLs.
        let part = SinglePart::builder()
            .header(ContentType::TEXT_PLAIN)
            .header(ContentTransferEncoding::Base64)
            .body(body);
        let msg = Message::builder()
            .from(self.from.clone())
            .to(to.clone())
            .subject(subject)
            .singlepart(part)
            .map_err(|e| MailError::Build(e.to_string()))?;
        let _ = lettre::AsyncTransport::send(&self.transport, msg).await?;
        info!(?to, %subject, "mail sent");
        Ok(())
    }
}
