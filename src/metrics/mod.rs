//! Monitoring metrics and SLO management.
//!
//! Provides in-memory time-series metrics collection from
//! scenario runs, SLO definitions, and error budget
//! calculation.

pub mod collector;
pub mod model;
pub mod slo;
pub mod store;

pub use collector::InMemoryMetricsCollector;
pub use model::*;
pub use store::MetricsStore;
