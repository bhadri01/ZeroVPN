-- Multi-timeframe bandwidth "candles" (trading-style HL + average) for the
-- per-device and server-wide rate charts.
--
-- Design: the 1-MINUTE candle is the single source of truth. The worker
-- accumulates each peer's per-second rate in memory and flushes one row per
-- peer per minute (HL + sum + sample count → exact average at any rollup).
-- Every coarser timeframe (3m/5m/15m/30m/1h) is derived on read via
-- date_bin() over the 1-minute table: high = max(high), low = min(low),
-- avg = sum(sum)/sum(samples). A daily rollup table keeps the long
-- timeframes (1d/7d/1month) cheap so they don't scan months of 1-minute rows.
--
-- Rates are stored in bits/sec (bigint). Plain tables + a retention DELETE
-- (see worker `retention.rs`), matching how the other high-volume tables are
-- pruned.

-- Per-device 1-minute base candles.
CREATE TABLE bandwidth_candles_1m (
    device_id    UUID        NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    bucket_start TIMESTAMPTZ NOT NULL,            -- minute (UTC), floor of the tick time
    rx_high      BIGINT      NOT NULL,
    rx_low       BIGINT      NOT NULL,
    rx_sum       BIGINT      NOT NULL,            -- Σ per-second rx rate over the minute
    tx_high      BIGINT      NOT NULL,
    tx_low       BIGINT      NOT NULL,
    tx_sum       BIGINT      NOT NULL,
    samples      INT         NOT NULL,            -- ticks folded into this candle
    PRIMARY KEY (device_id, bucket_start)
);
CREATE INDEX idx_candles_1m_time ON bandwidth_candles_1m (bucket_start);

-- Per-device daily rollup (derived from 1m by the aggregator) — backs 1d/7d/1month.
CREATE TABLE bandwidth_candles_1d (
    device_id    UUID        NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    bucket_start TIMESTAMPTZ NOT NULL,            -- day (UTC midnight)
    rx_high      BIGINT      NOT NULL,
    rx_low       BIGINT      NOT NULL,
    rx_sum       BIGINT      NOT NULL,
    tx_high      BIGINT      NOT NULL,
    tx_low       BIGINT      NOT NULL,
    tx_sum       BIGINT      NOT NULL,
    samples      INT         NOT NULL,
    PRIMARY KEY (device_id, bucket_start)
);
CREATE INDEX idx_candles_1d_time ON bandwidth_candles_1d (bucket_start);

-- Server-aggregate candles (sum across all peers per minute) — admin Overview.
CREATE TABLE server_candles_1m (
    server_id    UUID        NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    bucket_start TIMESTAMPTZ NOT NULL,
    rx_high      BIGINT      NOT NULL,
    rx_low       BIGINT      NOT NULL,
    rx_sum       BIGINT      NOT NULL,
    tx_high      BIGINT      NOT NULL,
    tx_low       BIGINT      NOT NULL,
    tx_sum       BIGINT      NOT NULL,
    samples      INT         NOT NULL,
    PRIMARY KEY (server_id, bucket_start)
);
CREATE INDEX idx_server_candles_1m_time ON server_candles_1m (bucket_start);

CREATE TABLE server_candles_1d (
    server_id    UUID        NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    bucket_start TIMESTAMPTZ NOT NULL,
    rx_high      BIGINT      NOT NULL,
    rx_low       BIGINT      NOT NULL,
    rx_sum       BIGINT      NOT NULL,
    tx_high      BIGINT      NOT NULL,
    tx_low       BIGINT      NOT NULL,
    tx_sum       BIGINT      NOT NULL,
    samples      INT         NOT NULL,
    PRIMARY KEY (server_id, bucket_start)
);
CREATE INDEX idx_server_candles_1d_time ON server_candles_1d (bucket_start);
