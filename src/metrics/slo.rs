//! SLO status calculation and error budget evaluation.

use super::model::{
    ErrorBudget, MonitoringMetric, MonitoringSlo, SloStatus,
};

/// Calculate the current SLO status from metrics within the
/// window.
pub fn evaluate_slo(
    slo: &MonitoringSlo,
    metrics: &[MonitoringMetric],
) -> SloStatus {
    let total_runs = metrics.len() as u64;
    let successful_runs =
        metrics.iter().filter(|m| m.success).count() as u64;

    let current_availability = if total_runs == 0 {
        1.0
    } else {
        successful_runs as f64 / total_runs as f64
    };

    let is_met = current_availability >= slo.target_availability;

    // Average P95 latency across runs in the window.
    let avg_p95_latency_ms = if metrics.is_empty() {
        0.0
    } else {
        let sum: u64 = metrics.iter().map(|m| m.latency.p95).sum();
        sum as f64 / metrics.len() as f64
    };

    let latency_met =
        avg_p95_latency_ms <= slo.latency_p95_threshold_ms as f64;

    let error_budget = compute_error_budget(
        slo.target_availability,
        total_runs,
        successful_runs,
    );

    SloStatus {
        slo: slo.clone(),
        total_runs,
        successful_runs,
        current_availability,
        is_met,
        avg_p95_latency_ms,
        latency_met,
        error_budget,
    }
}

/// Compute the error budget given a target availability.
fn compute_error_budget(
    target: f64,
    total_runs: u64,
    successful_runs: u64,
) -> ErrorBudget {
    if total_runs == 0 {
        return ErrorBudget {
            total_allowed_failures: 0.0,
            consumed_failures: 0,
            remaining_fraction: 1.0,
            exhausted: false,
        };
    }

    let failure_rate = 1.0 - target;
    let total_allowed = failure_rate * total_runs as f64;
    let consumed = total_runs - successful_runs;

    let remaining_fraction = if total_allowed <= 0.0 {
        if consumed > 0 {
            0.0
        } else {
            1.0
        }
    } else {
        ((total_allowed - consumed as f64) / total_allowed).clamp(0.0, 1.0)
    };

    ErrorBudget {
        total_allowed_failures: total_allowed,
        consumed_failures: consumed,
        remaining_fraction,
        exhausted: consumed as f64 >= total_allowed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::metrics::model::LatencyPercentiles;
    use chrono::Utc;
    use std::collections::HashMap;

    fn make_metric(success: bool, p95: u64) -> MonitoringMetric {
        MonitoringMetric {
            id: "m1".into(),
            scenario_id: "s1".into(),
            scenario_name: "test".into(),
            recorded_at: Utc::now(),
            step_latencies_ms: vec![p95],
            latency: LatencyPercentiles {
                min: p95,
                p50: p95,
                p95,
                p99: p95,
                max: p95,
            },
            status_codes: HashMap::new(),
            total_duration_ms: p95,
            success,
        }
    }

    fn make_slo() -> MonitoringSlo {
        MonitoringSlo {
            id: "slo1".into(),
            scenario_id: "s1".into(),
            name: "Test SLO".into(),
            target_availability: 0.99,
            latency_p95_threshold_ms: 500,
            window_seconds: 86400,
            created_at: Utc::now(),
        }
    }

    #[test]
    fn test_slo_all_pass() {
        let slo = make_slo();
        let metrics: Vec<MonitoringMetric> =
            (0..100).map(|_| make_metric(true, 100)).collect();
        let status = evaluate_slo(&slo, &metrics);

        assert!(status.is_met);
        assert!(status.latency_met);
        assert_eq!(status.current_availability, 1.0);
        assert_eq!(status.error_budget.remaining_fraction, 1.0);
        assert!(!status.error_budget.exhausted);
    }

    #[test]
    fn test_slo_budget_exhausted() {
        let slo = make_slo(); // 99% target
                              // 2 failures out of 100 -> 98% -> below 99%
        let mut metrics: Vec<MonitoringMetric> =
            (0..98).map(|_| make_metric(true, 100)).collect();
        metrics.push(make_metric(false, 100));
        metrics.push(make_metric(false, 100));

        let status = evaluate_slo(&slo, &metrics);
        assert!(!status.is_met);
        assert_eq!(status.error_budget.consumed_failures, 2);
        assert!(status.error_budget.exhausted);
    }

    #[test]
    fn test_slo_latency_exceeded() {
        let slo = make_slo(); // threshold 500ms
        let metrics: Vec<MonitoringMetric> =
            (0..10).map(|_| make_metric(true, 600)).collect();

        let status = evaluate_slo(&slo, &metrics);
        assert!(status.is_met); // availability ok
        assert!(!status.latency_met); // latency exceeded
    }

    #[test]
    fn test_slo_no_metrics() {
        let slo = make_slo();
        let status = evaluate_slo(&slo, &[]);

        assert!(status.is_met);
        assert_eq!(status.total_runs, 0);
        assert_eq!(status.error_budget.remaining_fraction, 1.0);
    }
}
