use serde::Deserialize;

/// Optional Google OAuth 2.0 client config. When present, `/auth/google/*`
/// routes are wired; when absent, those routes return 503 so the rest of
/// the API still boots without OAuth credentials configured.
#[derive(Debug, Clone, Deserialize)]
pub struct GoogleOAuthConfig {
    pub client_id: String,
    pub client_secret: String,
    /// The redirect URL registered in the Google Cloud Console. Used both
    /// in the initial auth URL and the token exchange — must match exactly.
    pub redirect_url: String,
}
