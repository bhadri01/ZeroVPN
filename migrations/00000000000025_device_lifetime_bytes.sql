-- Per-device lifetime byte counters — the authoritative "Total RX/TX" shown
-- on device cards and detail. Previously the UI total was SUM(bandwidth_
-- aggregates, bucket='hour'), which lagged the live rate (hourly rollups run
-- every ~60s) and never matched `wg show`. The worker now maintains these
-- columns directly: it seeds them to the live `wg show` counter on first
-- sight (GREATEST, so a worker restart catches up missed bytes without
-- double-counting) and increments them by each per-tick delta thereafter.
-- Because they only ever grow, they survive WireGuard counter resets (peer
-- re-add on key rotation / pause-resume / tunnel recreation) — a true
-- "total data used", not the resettable per-connection counter.
ALTER TABLE devices
    ADD COLUMN lifetime_rx_bytes BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN lifetime_tx_bytes BIGINT NOT NULL DEFAULT 0;

-- Backfill from the historical aggregates so existing devices don't reset to
-- zero on deploy. Sums the 'hour' rollups (the 'day' rows are derived from
-- the same hours, so a bucket-agnostic sum would double-count).
UPDATE devices d
   SET lifetime_rx_bytes = t.rx,
       lifetime_tx_bytes = t.tx
  FROM (
        SELECT device_id,
               COALESCE(SUM(rx_bytes), 0)::BIGINT AS rx,
               COALESCE(SUM(tx_bytes), 0)::BIGINT AS tx
          FROM bandwidth_aggregates
         WHERE bucket = 'hour'::bucket_kind
         GROUP BY device_id
       ) t
 WHERE t.device_id = d.id;
