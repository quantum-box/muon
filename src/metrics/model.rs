//! Domain models for monitoring metrics and SLOs.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── monitoring_metrics (time-series) ──────────────────

/// A single metrics data point recorded after a scenario
/// run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitoringMetric {
    /// Unique metric ID.
    pub id: String,
    /// Scenario ID this metric belongs to.
    pub scenario_id: String,
    /// Scenario name (denormalized for convenience).
    pub scenario_name: String,
    /// When this metric was recorded.
    pub recorded_at: DateTime<Utc>,
    /// Per-step latencies in milliseconds.
    pub step_latencies_ms: Vec<u64>,
    /// Latency percentiles computed from step latencies.
    pub latency: LatencyPercentiles,
    /// HTTP status code distribution across all steps.
    pub status_codes: HashMap<u16, u32>,
    /// Total scenario duration in milliseconds.
    pub total_duration_ms: u64,
    /// Whether the scenario run succeeded.
    pub success: bool,
}

/// Latency percentile breakdown.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LatencyPercentiles {
    /// Minimum observed latency (ms).
    pub min: u64,
    /// 50th percentile (median) latency (ms).
    pub p50: u64,
    /// 95th percentile latency (ms).
    pub p95: u64,
    /// 99th percentile latency (ms).
    pub p99: u64,
    /// Maximum observed latency (ms).
    pub max: u64,
}

// ── monitoring_slos ───────────────────────────────────

/// SLO definition for a scenario.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitoringSlo {
    /// Unique SLO ID.
    pub id: String,
    /// Scenario ID this SLO is attached to.
    pub scenario_id: String,
    /// Human-readable SLO name.
    pub name: String,
    /// Target availability as a fraction (e.g. 0.999).
    pub target_availability: f64,
    /// Maximum acceptable P95 latency in ms.
    pub latency_p95_threshold_ms: u64,
    /// Rolling window size in seconds.
    pub window_seconds: u64,
    /// When this SLO was created.
    pub created_at: DateTime<Utc>,
}

/// Input for creating a new SLO definition.
#[derive(Debug, Clone, Deserialize)]
pub struct CreateSloInput {
    pub scenario_id: String,
    pub name: String,
    pub target_availability: f64,
    pub latency_p95_threshold_ms: u64,
    #[serde(default = "default_window")]
    pub window_seconds: u64,
}

fn default_window() -> u64 {
    86400 // 24 hours
}

// ── SLO status (computed) ─────────────────────────────

/// Calculated SLO status with error budget.
#[derive(Debug, Clone, Serialize)]
pub struct SloStatus {
    /// The SLO definition.
    pub slo: MonitoringSlo,
    /// Total runs in the window.
    pub total_runs: u64,
    /// Successful runs in the window.
    pub successful_runs: u64,
    /// Current availability as a fraction.
    pub current_availability: f64,
    /// Whether the SLO is currently met.
    pub is_met: bool,
    /// Average P95 latency in the window.
    pub avg_p95_latency_ms: f64,
    /// Whether the latency SLO is met.
    pub latency_met: bool,
    /// Error budget: remaining fraction of allowed failures.
    pub error_budget: ErrorBudget,
}

/// Error budget details.
#[derive(Debug, Clone, Serialize)]
pub struct ErrorBudget {
    /// Total allowed failures in the window.
    pub total_allowed_failures: f64,
    /// Failures consumed so far.
    pub consumed_failures: u64,
    /// Remaining budget as a fraction (0.0 – 1.0).
    pub remaining_fraction: f64,
    /// Whether the budget is exhausted.
    pub exhausted: bool,
}

// ── Aggregated summary ────────────────────────────────

/// Aggregated metrics summary returned by the API.
#[derive(Debug, Clone, Serialize)]
pub struct MetricsSummary {
    /// Per-scenario aggregated metrics.
    pub scenarios: Vec<ScenarioMetrics>,
    /// SLO statuses.
    pub slos: Vec<SloStatus>,
    /// Total data points across all scenarios.
    pub total_data_points: usize,
}

/// Aggregated metrics for a single scenario.
#[derive(Debug, Clone, Serialize)]
pub struct ScenarioMetrics {
    pub scenario_id: String,
    pub scenario_name: String,
    /// Number of recorded runs.
    pub run_count: u64,
    /// Success rate as a fraction.
    pub success_rate: f64,
    /// Aggregated latency percentiles across all runs.
    pub latency: LatencyPercentiles,
    /// Aggregated status code distribution.
    pub status_codes: HashMap<u16, u32>,
    /// Average duration in ms.
    pub avg_duration_ms: f64,
    /// Most recent data points (newest first).
    pub recent: Vec<MonitoringMetric>,
}
