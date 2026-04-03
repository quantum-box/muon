//! REST API route handlers for the muon web server.

use crate::model::TestScenario;
use crate::runner::DefaultTestRunner;
use crate::server::sse::run_event_stream;
use crate::server::state::{AppState, RunRecord, RunStatus, ScenarioInfo};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::mpsc;
use tracing::error;

/// Build the API sub-router with all endpoints.
pub fn api_routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/scenarios", get(list_scenarios).post(create_scenario))
        .route(
            "/scenarios/:id",
            get(get_scenario)
                .put(update_scenario)
                .delete(delete_scenario),
        )
        .route("/scenarios/:id/run", post(run_scenario))
        .route("/runs", get(list_runs))
        .route("/runs/:id", get(get_run))
}

/// `GET /api/scenarios` — List all loaded scenarios.
async fn list_scenarios(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let scenarios = state.scenarios.read().await;
    Json(scenarios.clone())
}

/// Response envelope matching the frontend `ScenarioDetail`
/// type.
#[derive(Serialize)]
struct ScenarioDetailResponse {
    id: String,
    name: String,
    description: Option<String>,
    tags: Vec<String>,
    file_path: PathBuf,
    scenario: TestScenario,
}

/// `GET /api/scenarios/:id` — Get full scenario detail.
async fn get_scenario(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    let scenarios = state.scenarios.read().await;
    let info = scenarios
        .iter()
        .find(|s| s.id == id)
        .ok_or(StatusCode::NOT_FOUND)?;

    // Load the full scenario from file
    let scenario =
        state.load_scenario_by_path(&info.file_path).map_err(|e| {
            error!("Failed to load scenario {}: {}", id, e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let detail = ScenarioDetailResponse {
        id: info.id.clone(),
        name: info.name.clone(),
        description: info.description.clone(),
        tags: info.tags.clone(),
        file_path: info.file_path.clone(),
        scenario,
    };

    Ok(Json(detail))
}

/// `POST /api/scenarios/:id/run` — Execute a scenario and
/// stream results via SSE.
async fn run_scenario(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    // Find scenario info
    let (file_path, scenario_name) = {
        let scenarios = state.scenarios.read().await;
        let info = scenarios
            .iter()
            .find(|s| s.id == id)
            .ok_or(StatusCode::NOT_FOUND)?;
        (info.file_path.clone(), info.name.clone())
    };

    // Parse the scenario
    let scenario: TestScenario =
        state.load_scenario_by_path(&file_path).map_err(|e| {
            error!("Failed to load scenario {}: {}", id, e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // Create run record
    let run_id = uuid::Uuid::new_v4().to_string();
    let run_record = RunRecord {
        id: run_id.clone(),
        scenario_id: id.clone(),
        scenario_name: scenario_name.clone(),
        result: None,
        started_at: Utc::now(),
        status: RunStatus::Running,
    };
    state.run_repo.insert(&run_record).await.map_err(|e| {
        error!("Failed to save run: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Create event channel
    let (tx, rx) = mpsc::channel(64);

    // Spawn execution task
    let state_clone = state.clone();
    let run_id_clone = run_id.clone();
    tokio::spawn(async move {
        let runner = DefaultTestRunner::new();
        let result = runner.run_with_events(&scenario, tx).await;

        let mut record = match state_clone.run_repo.get(&run_id_clone).await
        {
            Ok(Some(r)) => r,
            _ => return,
        };

        match result {
            Ok(test_result) => {
                record.status = if test_result.success {
                    RunStatus::Completed
                } else {
                    RunStatus::Failed
                };
                record.result = Some(test_result);
            }
            Err(e) => {
                error!("Run {} failed: {}", run_id_clone, e);
                record.status = RunStatus::Failed;
            }
        }

        if let Err(e) = state_clone.run_repo.update(&record).await {
            error!("Failed to update run {}: {}", run_id_clone, e);
        }
    });

    Ok(run_event_stream(rx))
}

/// `GET /api/runs` — List all past runs.
async fn list_runs(
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, StatusCode> {
    let records = state.run_repo.list_all().await.map_err(|e| {
        error!("Failed to list runs: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    Ok(Json(records))
}

/// `GET /api/runs/:id` — Get a specific run's detail.
async fn get_run(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    let record = state
        .run_repo
        .get(&id)
        .await
        .map_err(|e| {
            error!("Failed to get run: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?
        .ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(record))
}

// ── Scenario CRUD ──────────────────────────────────────

/// JSON body for creating or updating a scenario.
#[derive(Debug, Deserialize)]
struct ScenarioPayload {
    name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    steps: Vec<crate::model::TestStep>,
    #[serde(default)]
    vars: HashMap<String, serde_json::Value>,
    #[serde(default)]
    config: crate::model::TestConfig,
}

impl ScenarioPayload {
    fn into_scenario(self) -> TestScenario {
        TestScenario {
            name: self.name,
            description: self.description,
            tags: self.tags,
            steps: self.steps,
            vars: self.vars,
            config: self.config,
        }
    }
}

/// `PUT /api/scenarios/:id` — Update an existing scenario.
async fn update_scenario(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(payload): Json<ScenarioPayload>,
) -> Result<impl IntoResponse, StatusCode> {
    let file_path = {
        let scenarios = state.scenarios.read().await;
        let info = scenarios
            .iter()
            .find(|s| s.id == id)
            .ok_or(StatusCode::NOT_FOUND)?;
        info.file_path.clone()
    };

    let scenario = payload.into_scenario();
    let yaml = scenario.to_yaml().map_err(|e| {
        error!("Failed to serialize scenario: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    std::fs::write(&file_path, &yaml).map_err(|e| {
        error!("Failed to write scenario file: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Reload to update in-memory state
    state.reload_scenarios().await;

    Ok(Json(scenario))
}

/// `POST /api/scenarios` — Create a new scenario.
async fn create_scenario(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ScenarioPayload>,
) -> Result<impl IntoResponse, StatusCode> {
    let filename = slugify(&payload.name) + ".yaml";
    let file_path = state.scenario_dir.join(&filename);

    if file_path.exists() {
        return Err(StatusCode::CONFLICT);
    }

    let scenario = payload.into_scenario();
    let yaml = scenario.to_yaml().map_err(|e| {
        error!("Failed to serialize scenario: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Ensure directory exists
    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            error!("Failed to create directory: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    }

    std::fs::write(&file_path, &yaml).map_err(|e| {
        error!("Failed to write scenario file: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    state.reload_scenarios().await;

    let info = ScenarioInfo::from_scenario(&scenario, &file_path);
    Ok((StatusCode::CREATED, Json(info)))
}

/// `DELETE /api/scenarios/:id` — Delete a scenario file.
async fn delete_scenario(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    let file_path = {
        let scenarios = state.scenarios.read().await;
        let info = scenarios
            .iter()
            .find(|s| s.id == id)
            .ok_or(StatusCode::NOT_FOUND)?;
        info.file_path.clone()
    };

    std::fs::remove_file(&file_path).map_err(|e| {
        error!("Failed to delete scenario file: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    state.reload_scenarios().await;

    Ok(StatusCode::NO_CONTENT)
}

/// Convert a name into a filesystem-safe slug.
fn slugify(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}
