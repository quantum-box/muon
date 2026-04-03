//! Health check endpoint for monitoring and liveness probes.

use crate::server::schedules::ScheduleState;
use axum::extract::State;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;
use std::sync::OnceLock;
use std::time::Instant;

static START_TIME: OnceLock<Instant> = OnceLock::new();

/// Record the server start time. Call once during init.
pub fn record_start_time() {
    let _ = START_TIME.set(Instant::now());
}

fn uptime_secs() -> u64 {
    START_TIME.get().map(|t| t.elapsed().as_secs()).unwrap_or(0)
}

/// Build the health check sub-router.
pub fn health_routes() -> Router<ScheduleState> {
    Router::new().route("/health", get(health_check))
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    version: &'static str,
    uptime_secs: u64,
    scenarios_loaded: usize,
    active_schedules: usize,
}

/// `GET /api/health`
async fn health_check(
    State(state): State<ScheduleState>,
) -> impl IntoResponse {
    let scenarios_loaded = state.app_state.scenarios.read().await.len();
    let active_schedules = state.scheduler.active_count().await;

    Json(HealthResponse {
        status: "ok",
        version: crate::VERSION,
        uptime_secs: uptime_secs(),
        scenarios_loaded,
        active_schedules,
    })
}
