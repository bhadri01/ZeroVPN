-- Stage C — destination IP capture.
--
-- Stores per-flow / per-destination records observed from the WG
-- netns via NFLOG/conntrack/ulogd2 or another exporter. The worker
-- will resolve the source IP to a known `device_id` + `user_id` when
-- possible; the columns are nullable to allow best-effort writes when
-- the mapping is not yet known.

CREATE TABLE destination_ips (
    id            BIGSERIAL PRIMARY KEY,
    device_id     UUID      REFERENCES devices(id) ON DELETE SET NULL,
    user_id       UUID      REFERENCES users(id)   ON DELETE SET NULL,
    src_ip        INET      NOT NULL,
    src_port      INT,
    dst_ip        INET      NOT NULL,
    dst_port      INT,
    proto         TEXT,
    bytes_in      BIGINT    NOT NULL DEFAULT 0,
    bytes_out     BIGINT    NOT NULL DEFAULT 0,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at      TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_destination_ips_device_recent
    ON destination_ips(device_id, started_at DESC);

CREATE INDEX idx_destination_ips_dst_ip
    ON destination_ips(dst_ip);

CREATE INDEX idx_destination_ips_open
    ON destination_ips(device_id, started_at DESC)
    WHERE ended_at IS NULL;
