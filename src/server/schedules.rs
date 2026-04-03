//! REST API routes for schedule management.

use crate::server::scheduler::SchedulerManager;
use crate::server::state::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use std::sync::Arc;

/// Shared state wrapper for schedule routes.
///
/// Schedule routes need both the `AppState` and the
/// `SchedulerManager`, so we bundle them here.
#[derive(Clone)]
pub struct ScheduleState {
    pub app_state: Arc<AppState>,
    pub scheduler: Arc<SchedulerManager>,
}

/// Build the schedule sub-router.
pub fn schedule_routes() -> Router<ScheduleState> {
    Router::new()
        .route("/schedules", get(list_schedules).post(create_schedule))
        .route(
            "/schedules/:id",
            get(get_schedule)
                .put(update_schedule)
                .delete(delete_schedule),
        )
        .route("/schedules/:id/trigger", post(trigger_schedule))
}

/// `GET /api/schedules`
async fn list_schedules(
    State(state): State<ScheduleState>,
) -> impl IntoResponse {
    let schedules = state.scheduler.list().await;
    Json(schedules)
}

/// `GET /api/schedules/:id`
async fn get_schedule(
    State(state): State<ScheduleState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    state
        .scheduler
        .get(&id)
        .await
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

/// JSON body for creating a schedule.
#[derive(Debug, Deserialize)]
struct CreateSchedulePayload {
    name: String,
    scenario_id: String,
    cron_expr: String,
    #[serde(default = "default_true")]
    enabled: bool,
}

fn default_true() -> bool {
    true
}

/// `POST /api/schedules`
async fn create_schedule(
    State(state): State<ScheduleState>,
    Json(payload): Json<CreateSchedulePayload>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let schedule = state
        .scheduler
        .create(
            payload.name,
            payload.scenario_id,
            payload.cron_expr,
            payload.enabled,
        )
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

    Ok((StatusCode::CREATED, Json(schedule)))
}

/// JSON body for updating a schedule.
#[derive(Debug, Deserialize)]
struct UpdateSchedulePayload {
    name: Option<String>,
    cron_expr: Option<String>,
    enabled: Option<bool>,
}

/// `PUT /api/schedules/:id`
async fn update_schedule(
    State(state): State<ScheduleState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateSchedulePayload>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let schedule = state
        .scheduler
        .update(&id, payload.name, payload.cron_expr, payload.enabled)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

    Ok(Json(schedule))
}

/// `DELETE /api/schedules/:id`
async fn delete_schedule(
    State(state): State<ScheduleState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    state
        .scheduler
        .delete(&id)
        .await
        .map_err(|e| (StatusCode::NOT_FOUND, e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

/// `POST /api/schedules/:id/trigger`
async fn trigger_schedule(
    State(state): State<ScheduleState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let run_id = state
        .scheduler
        .trigger(&id)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

    Ok((
        StatusCode::ACCEPTED,
        Json(serde_json::json!({ "run_id": run_id })),
    ))
}
