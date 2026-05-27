-- Google OAuth 2.0 sign-in.
--
-- `users.google_id` links a row to a Google account. UNIQUE so the same
-- Google account can't be attached to two different users. Nullable
-- because password-only accounts keep working unchanged.
--
-- `password_hash` stays NOT NULL. OAuth-only users are created with the
-- same sentinel value soft_delete uses ('!') — argon2 can't verify it, so
-- the password-login path naturally refuses these accounts without any
-- extra check. A user can later set a real password via the standard
-- forgot-password flow, which just overwrites the hash.
--
-- `oauth_states` parks the short-lived `state` + PKCE verifier between the
-- redirect-to-Google and the callback. Hashed to keep raw state values out
-- of DB backups; consumed in one query (DELETE … RETURNING) so a replay
-- can't reuse the same code.

ALTER TABLE users ADD COLUMN google_id TEXT UNIQUE;

CREATE TABLE oauth_states (
    state_hash    TEXT        PRIMARY KEY,
    pkce_verifier TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at    TIMESTAMPTZ NOT NULL
);

CREATE INDEX oauth_states_expires_idx ON oauth_states (expires_at);
