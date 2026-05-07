CREATE TYPE webhook_event AS ENUM (
    'peer_connected',
    'peer_disconnected',
    'device_paused',
    'device_revoked',
    'bandwidth_threshold'
);

CREATE TABLE webhooks (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    secret_hashed TEXT,
    events webhook_event[] NOT NULL DEFAULT ARRAY[]::webhook_event[],
    active BOOLEAN NOT NULL DEFAULT TRUE,
    last_delivery_at TIMESTAMPTZ,
    last_status INT,
    failure_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_webhooks_active ON webhooks(active);
