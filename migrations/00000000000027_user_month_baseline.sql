-- Accurate monthly usage baseline for the dashboard "Quota" card.
--
-- The running counters (users/devices.current_month_bytes) and the rolled-up
-- bandwidth_aggregates can drift and over-report "this month" — they
-- accumulate per-tick deltas and reset only lazily, so dev/sim pollution and
-- missed resets leave inflated figures (e.g. 51 GB "this month" for an account
-- whose true lifetime usage is a few MB).
--
-- The per-device LIFETIME counters (devices.lifetime_rx/tx_bytes, migration 25)
-- are the trustworthy source — they track the real WG transfer counters. So we
-- derive this month's usage as a delta off lifetime:
--
--   used_this_cycle = (Σ device lifetime now) − (Σ device lifetime at cycle start)
--
-- These columns snapshot that cycle-start baseline. `month_baseline_at` marks
-- which monthly cycle the snapshot belongs to; the API re-snapshots lazily when
-- it sees a new cycle. NULL/0 defaults mean "not yet initialised" — the first
-- read seeds them.
ALTER TABLE users
    ADD COLUMN month_baseline_bytes BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN month_baseline_at    TIMESTAMPTZ;
