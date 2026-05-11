-- Migration 5: per-server time-series + unbounded device-sample retention.
--
-- This migration shifts the data model from "privacy-first, 7-day raw window"
-- to "trading-style, every-tick-kept-forever". The retention purger for
-- bandwidth_samples is now gated on ZEROVPN_SAMPLE_RETENTION_DAYS; the
-- default in code is unbounded. Aggregates already had no retention so
-- the long-term roll-up series is unaffected.
--
-- New table `server_samples` captures per-server totals at each poll tick:
-- summed RX/TX, total peer count, online peer count (handshake within
-- the last 3 poll intervals), and a "handshake count" for change-rate
-- charts. RANGE-partitioned monthly to match bandwidth_samples.

CREATE TABLE server_samples (
    server_id UUID NOT NULL,
    sampled_at TIMESTAMPTZ NOT NULL,
    total_rx_bytes BIGINT NOT NULL,
    total_tx_bytes BIGINT NOT NULL,
    peer_count INT NOT NULL,
    online_count INT NOT NULL,
    handshake_count INT NOT NULL,
    PRIMARY KEY (server_id, sampled_at)
) PARTITION BY RANGE (sampled_at);

CREATE INDEX idx_server_samples_time ON server_samples(sampled_at);

-- Bootstrap monthly partitions to match bandwidth_samples. Subsequent
-- months should be created by a maintenance job (TODO; same gap as the
-- existing bandwidth_samples partitioning — see TODO.md).
CREATE TABLE server_samples_2026_05 PARTITION OF server_samples
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE server_samples_2026_06 PARTITION OF server_samples
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE server_samples_2026_07 PARTITION OF server_samples
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
