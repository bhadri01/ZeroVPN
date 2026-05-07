-- Track last successful login IP prefix per user, so we can fire a
-- suspicious-login email when the prefix changes between logins.
-- Stored as INET so Postgres validates the value; the api stores a /24
-- (IPv4) or /48 (IPv6) prefix, never the full address.

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_ip_prefix INET;
