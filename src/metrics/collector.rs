//! MetricsCollector trait and in-memory implementation.

use super::model::{LatencyPercentiles, MonitoringMetric};
use super::store::MetricsStore;
use crate::model::TestResult;
use async_trait::async_trait;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::Arc;

/// Trait for collecting metrics from scenario runs.
#[async_trait]
pub trait MetricsCollector: Send + Sync {
    /// Record metrics from a completed scenario run.
    async fn record(
        &self,
        scenario_id: &str,
        scenario_name: &str,
        result: &TestResult,
    );
}

/// In-memory implementation backed by [`MetricsStore`].
pub struct InMemoryMetricsCollector {
    store: Arc<MetricsStore>,
}

impl InMemoryMetricsCollector {
    pub fn new(store: Arc<MetricsStore>) -> Self {
        Self { store }
    }
}

#[async_trait]
impl MetricsCollector for InMemoryMetricsCollector {
    async fn record(
        &self,
        scenario_id: &str,
        scenario_name: &str,
        result: &TestResult,
    ) {
        let step_latencies_ms: Vec<u64> =
            result.steps.iter().map(|s| s.duration_ms).collect();

        let status_codes = collect_status_codes(result);
        let latency = compute_percentiles(&step_latencies_ms);

        let metric = MonitoringMetric {
            id: uuid::Uuid::new_v4().to_string(),
            scenario_id: scenario_id.to_string(),
            scenario_name: scenario_name.to_string(),
            recorded_at: Utc::now(),
            step_latencies_ms,
            latency,
            status_codes,
            total_duration_ms: result.duration_ms,
            success: result.success,
        };

        self.store.record_metric(metric).await;
    }
}

/// Compute latency percentiles from a slice of durations.
pub fn compute_percentiles(latencies: &[u64]) -> LatencyPercentiles {
    if latencies.is_empty() {
        return LatencyPercentiles {
            min: 0,
            p50: 0,
            p95: 0,
            p99: 0,
            max: 0,
        };
    }

    let mut sorted = latencies.to_vec();
    sorted.sort_unstable();
    let len = sorted.len();

    LatencyPercentiles {
        min: sorted[0],
        p50: percentile_value(&sorted, 50.0),
        p95: percentile_value(&sorted, 95.0),
        p99: percentile_value(&sorted, 99.0),
        max: sorted[len - 1],
    }
}

/// Nearest-rank percentile.
fn percentile_value(sorted: &[u64], pct: f64) -> u64 {
    let idx = ((pct / 100.0) * sorted.len() as f64).ceil() as usize;
    sorted[idx.saturating_sub(1).min(sorted.len() - 1)]
}

/// Aggregate HTTP status codes from step responses.
fn collect_status_codes(result: &TestResult) -> HashMap<u16, u32> {
    let mut map = HashMap::new();
    for step in &result.steps {
        if let Some(resp) = &step.response {
            *map.entry(resp.status).or_insert(0) += 1;
        }
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_percentiles_single_value() {
        let p = compute_percentiles(&[42]);
        assert_eq!(p.min, 42);
        assert_eq!(p.p50, 42);
        assert_eq!(p.p95, 42);
        assert_eq!(p.p99, 42);
        assert_eq!(p.max, 42);
    }

    #[test]
    fn test_percentiles_multiple_values() {
        // 1..=100
        let vals: Vec<u64> = (1..=100).collect();
        let p = compute_percentiles(&vals);
        assert_eq!(p.min, 1);
        assert_eq!(p.p50, 50);
        assert_eq!(p.p95, 95);
        assert_eq!(p.p99, 99);
        assert_eq!(p.max, 100);
    }

    #[test]
    fn test_percentiles_empty() {
        let p = compute_percentiles(&[]);
        assert_eq!(p.min, 0);
        assert_eq!(p.p50, 0);
        assert_eq!(p.max, 0);
    }
}
