//! REST API route handlers for the muon web server.

use crate::metrics::collector::InMemoryMetricsCollector;
use crate::metrics::collector::MetricsCollector;
use crate::model::TestScenario;
use crate::runner::DefaultTestRunner;
use crate::server::sse::run_event_stream;
use crate::server::state::{AppState, RunRecord, RunStatus, ScenarioInfo};
use crate::webhook::{self, WebhookConfig, WebhookSender, WebhookType};
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
use tracing::{error, info};

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
        .route(
            "/scenarios/:id/webhooks",
            get(get_scenario_webhooks).put(update_scenario_webhooks),
        )
        .route("/runs", get(list_runs))
        .route("/runs/:id", get(get_run))
        .route("/webhook-config/test", post(test_webhook))
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
    state.runs.write().await.insert(run_id.clone(), run_record);

    // Create event channel
    let (tx, rx) = mpsc::channel(64);

    // Spawn execution task
    let state_clone = state.clone();
    let run_id_clone = run_id.clone();
    let scenario_id_clone = id.clone();
    let scenario_name_clone = scenario_name.clone();
    tokio::spawn(async move {
        let runner = DefaultTestRunner::new();
        let result = runner.run_with_events(&scenario, tx).await;

        let mut runs = state_clone.runs.write().await;
        if let Some(record) = runs.get_mut(&run_id_clone) {
            match result {
                Ok(test_result) => {
                    record.status = if test_result.success {
                        RunStatus::Completed
                    } else {
                        RunStatus::Failed
                    };

                    // Record metrics from this run.
                    let collector = InMemoryMetricsCollector::new(
                        state_clone.metrics_store.clone(),
                    );
                    collector
                        .record(
                            &scenario_id_clone,
                            &scenario_name_clone,
                            &test_result,
                        )
                        .await;

                    record.result = Some(test_result);
                }
                Err(e) => {
                    error!("Run {} failed: {}", run_id_clone, e);
                    record.status = RunStatus::Failed;
                }
            }
        }
    });

    Ok(run_event_stream(rx))
}

/// `GET /api/runs` — List all past runs.
async fn list_runs(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let runs = state.runs.read().await;
    let mut records: Vec<&RunRecord> = runs.values().collect();
    records.sort_by_key(|b| std::cmp::Reverse(b.started_at));
    Json(records.into_iter().cloned().collect::<Vec<_>>())
}

/// `GET /api/runs/:id` — Get a specific run's detail.
async fn get_run(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    let runs = state.runs.read().await;
    let record = runs.get(&id).ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(record.clone()))
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
    #[serde(default)]
    webhooks: Vec<crate::webhook::WebhookConfig>,
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
            webhooks: self.webhooks,
            ..Default::default()
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

// ── Webhook endpoints ─────────────────────────────────

/// `GET /api/scenarios/:id/webhooks` — Get webhook configs
/// for a scenario.
async fn get_scenario_webhooks(
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

    let scenario =
        state.load_scenario_by_path(&file_path).map_err(|e| {
            error!("Failed to load scenario {}: {}", id, e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(Json(scenario.webhooks))
}

/// `PUT /api/scenarios/:id/webhooks` — Update webhook
/// configs for a scenario.
async fn update_scenario_webhooks(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(webhooks): Json<Vec<WebhookConfig>>,
) -> Result<impl IntoResponse, StatusCode> {
    let file_path = {
        let scenarios = state.scenarios.read().await;
        let info = scenarios
            .iter()
            .find(|s| s.id == id)
            .ok_or(StatusCode::NOT_FOUND)?;
        info.file_path.clone()
    };

    let mut scenario =
        state.load_scenario_by_path(&file_path).map_err(|e| {
            error!("Failed to load scenario {}: {}", id, e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    scenario.webhooks = webhooks.clone();

    let yaml = scenario.to_yaml().map_err(|e| {
        error!("Failed to serialize scenario: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    std::fs::write(&file_path, &yaml).map_err(|e| {
        error!("Failed to write scenario file: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    state.reload_scenarios().await;

    Ok(Json(webhooks))
}

/// Request body for the test webhook endpoint.
#[derive(Debug, Deserialize)]
struct TestWebhookPayload {
    url: String,
    #[serde(default = "default_test_webhook_type")]
    webhook_type: WebhookType,
    #[serde(default)]
    headers: HashMap<String, String>,
}

fn default_test_webhook_type() -> WebhookType {
    WebhookType::Generic
}

/// `POST /api/webhook-config/test` — Send a test
/// notification to verify webhook connectivity.
async fn test_webhook(
    Json(payload): Json<TestWebhookPayload>,
) -> Result<impl IntoResponse, StatusCode> {
    let config = WebhookConfig {
        url: payload.url,
        webhook_type: payload.webhook_type.clone(),
        notify_on: webhook::NotifyOn::Always,
        name: Some("Test notification".to_string()),
        headers: payload.headers,
        max_retries: 0,
        retry_interval_ms: 1000,
    };

    let sample_results = vec![crate::model::TestResult {
        name: "sample-scenario".to_string(),
        success: true,
        error: None,
        steps: vec![crate::model::StepResult {
            name: "sample-step".to_string(),
            success: true,
            error: None,
            request: crate::model::RequestInfo {
                method: "GET".to_string(),
                url: "http://example.com/api/health".to_string(),
                headers: HashMap::new(),
                body: None,
            },
            response: None,
            duration_ms: 42,
        }],
        duration_ms: 50,
    }];

    let test_payload = webhook::template::build_payload(
        &payload.webhook_type,
        &sample_results,
        None,
    );

    let sender = WebhookSender::new();
    let result = sender.send(&config, &test_payload).await;

    if result.success {
        info!("Test webhook delivered to {}", result.url_redacted);
        Ok(Json(serde_json::json!({
            "success": true,
            "message": "Test notification sent successfully",
            "status_code": result.status_code,
        })))
    } else {
        error!("Test webhook failed: {:?}", result.error);
        Ok(Json(serde_json::json!({
            "success": false,
            "error": result.error,
            "status_code": result.status_code,
        })))
    }
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
