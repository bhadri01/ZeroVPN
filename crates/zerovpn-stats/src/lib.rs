//! Real-time stats poller, in-memory delta tracking, batch DB ingestion,
//! hourly/daily/monthly aggregation, retention purger.

pub mod aggregator;
pub mod poller;
pub mod retention;
