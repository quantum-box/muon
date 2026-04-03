//! REST API handlers for monitoring metrics and SLOs.

use crate::metrics::collector::compute_percentiles;
use crate::metrics::model::{
    CreateSloInput, MetricsSummary, MonitoringSlo, ScenarioMetrics,
    SloStatus,
};
use crate::metrics::slo::evaluate_slo;
use crate::server::state::AppState;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get};
use axum::{Json, Router};
use chrono::Utc;
use std::collections::HashMap;
use std::sync::Arc;

/// Build the metrics sub-router.
pub fn metrics_routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/metrics", get(get_metrics))
        .route("/metrics/slos", get(list_slos).post(create_slo))
        .route("/metrics/slos/:id", delete(delete_slo))
}

/// `GET /api/metrics` — Aggregated metrics summary with
/// SLO statuses.
async fn get_metrics(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let store = &state.metrics_store;
    let all_metrics = store.get_all_metrics().await;
    let all_slos = store.get_all_slos().await;

    let mut scenarios = Vec::new();

    for (scenario_id, metrics) in &all_metrics {
        if metrics.is_empty() {
            continue;
        }

        let scenario_name = metrics[0].scenario_name.clone();
        let run_count = metrics.len() as u64;
        let success_count =
            metrics.iter().filter(|m| m.success).count() as u64;
        let success_rate = success_count as f64 / run_count as f64;

        // Aggregate all step latencies across runs.
        let all_latencies: Vec<u64> = metrics
            .iter()
            .flat_map(|m| m.step_latencies_ms.iter().copied())
            .collect();
        let latency = compute_percentiles(&all_latencies);

        // Merge status code maps.
        let mut status_codes: HashMap<u16, u32> = HashMap::new();
        for m in metrics {
            for (&code, &count) in &m.status_codes {
                *status_codes.entry(code).or_insert(0) += count;
            }
        }

        let avg_duration_ms =
            metrics.iter().map(|m| m.total_duration_ms).sum::<u64>() as f64
                / run_count as f64;

        // Last 10 data points, newest first.
        let recent: Vec<_> =
            metrics.iter().rev().take(10).cloned().collect();

        scenarios.push(ScenarioMetrics {
            scenario_id: scenario_id.clone(),
            scenario_name,
            run_count,
            success_rate,
            latency,
            status_codes,
            avg_duration_ms,
            recent,
        });
    }

    // Evaluate SLOs.
    let mut slo_statuses: Vec<SloStatus> = Vec::new();
    for slo in &all_slos {
        let window_metrics = store
            .get_metrics_in_window(&slo.scenario_id, slo.window_seconds)
            .await;
        slo_statuses.push(evaluate_slo(slo, &window_metrics));
    }

    let total_data_points: usize =
        all_metrics.values().map(|v| v.len()).sum();

    Json(MetricsSummary {
        scenarios,
        slos: slo_statuses,
        total_data_points,
    })
}

/// `GET /api/metrics/slos` — List all SLO definitions.
async fn list_slos(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let slos = state.metrics_store.get_all_slos().await;
    Json(slos)
}

/// `POST /api/metrics/slos` — Create a new SLO definition.
async fn create_slo(
    State(state): State<Arc<AppState>>,
    Json(input): Json<CreateSloInput>,
) -> Result<impl IntoResponse, StatusCode> {
    if !(0.0..=1.0).contains(&input.target_availability) {
        return Err(StatusCode::BAD_REQUEST);
    }

    let slo = MonitoringSlo {
        id: uuid::Uuid::new_v4().to_string(),
        scenario_id: input.scenario_id,
        name: input.name,
        target_availability: input.target_availability,
        latency_p95_threshold_ms: input.latency_p95_threshold_ms,
        window_seconds: input.window_seconds,
        created_at: Utc::now(),
    };

    let resp = slo.clone();
    state.metrics_store.upsert_slo(slo).await;
    Ok((StatusCode::CREATED, Json(resp)))
}

/// `DELETE /api/metrics/slos/:id` — Delete an SLO.
async fn delete_slo(
    State(state): State<Arc<AppState>>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> impl IntoResponse {
    if state.metrics_store.delete_slo(&id).await {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::NOT_FOUND
    }
}
