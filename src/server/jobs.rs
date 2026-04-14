//! REST API endpoints for distributed job queue management.
//!
//! POST /api/jobs              — submit a new job to the queue
//! GET  /api/jobs/:id          — get job result by ID
//! GET  /api/workers           — list active workers (via heartbeat keys)
//! GET  /api/metrics/regions   — per-region latency summary

use crate::job::Job;
use crate::server::state::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::error;

/// Build the jobs sub-router (shares `AppState` with the main router).
pub fn jobs_routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/jobs", axum::routing::post(submit_job))
        .route("/jobs/:job_id", get(get_job))
        .route("/workers", get(list_workers))
        .route("/metrics/regions", get(region_metrics))
}

/// Request body for job submission.
#[derive(Debug, Deserialize)]
pub struct SubmitJobRequest {
    pub tenant_id: String,
    pub scenario_path: String,
    pub region: String,
}

/// `POST /api/jobs` — Enqueue a new scenario execution job.
async fn submit_job(
    State(state): State<Arc<AppState>>,
    Json(req): Json<SubmitJobRequest>,
) -> impl IntoResponse {
    let job = Job::new(req.tenant_id, req.scenario_path, req.region);
    match state.queue.enqueue(&job).await {
        Ok(job_id) => (
            StatusCode::CREATED,
            Json(serde_json::json!({ "job_id": job_id })),
        )
            .into_response(),
        Err(e) => {
            error!("Failed to enqueue job: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
                .into_response()
        }
    }
}

/// `GET /api/jobs/:job_id` — Retrieve job result.
async fn get_job(
    State(state): State<Arc<AppState>>,
    Path(job_id): Path<String>,
) -> impl IntoResponse {
    match state.queue.get_result(&job_id).await {
        Some(result) => Json(result).into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "job not found" })),
        )
            .into_response(),
    }
}

/// Worker info returned from the list endpoint.
#[derive(Serialize)]
struct WorkerInfo {
    worker_id: String,
    region: String,
    status: String,
}

/// `GET /api/workers` — List workers that have sent a heartbeat recently.
///
/// In Redis mode this would scan `muon:worker:*:heartbeat` keys.
/// Without Redis returns an empty list.
async fn list_workers(
    State(_state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let workers: Vec<WorkerInfo> = vec![];
    Json(workers)
}

/// Per-region latency summary.
#[derive(Serialize)]
struct RegionMetric {
    region: String,
    job_count: u64,
    avg_duration_ms: Option<f64>,
    success_rate: f64,
}

/// `GET /api/metrics/regions` — Aggregated per-region latency stats.
async fn region_metrics(
    State(_state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let metrics: Vec<RegionMetric> = vec![];
    Json(metrics)
}
