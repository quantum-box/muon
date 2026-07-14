//! Environment variable management API handlers.
//!
//! Environments are stored as YAML files under the
//! `.muon/environments/` directory relative to the
//! scenario directory's parent (project root).

use crate::server::state::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tracing::error;

/// Build the environment API sub-router.
pub fn env_routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/environments", get(list_environments))
        .route(
            "/environments/{name}",
            get(get_environment)
                .put(save_environment)
                .delete(delete_environment),
        )
}

/// On-disk representation of an environment file.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct EnvironmentFile {
    name: String,
    #[serde(default)]
    variables: HashMap<String, String>,
    #[serde(default)]
    sensitive_keys: Vec<String>,
}

/// JSON body for creating or updating an environment.
#[derive(Debug, Deserialize)]
struct EnvironmentPayload {
    variables: HashMap<String, String>,
    #[serde(default)]
    sensitive_keys: Vec<String>,
}

/// Resolve the environments directory from app state.
fn env_dir(state: &AppState) -> PathBuf {
    // Walk up from scenario_dir to project root, then
    // into .muon/environments/
    let project_root =
        state.scenario_dir.parent().unwrap_or(&state.scenario_dir);
    project_root.join(".muon").join("environments")
}

/// `GET /api/environments` — List all environments.
async fn list_environments(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let dir = env_dir(&state);
    let mut envs: Vec<EnvironmentFile> = Vec::new();

    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "yaml" || e == "yml") {
                if let Ok(content) = std::fs::read_to_string(&path) {
                    if let Ok(env) =
                        serde_yaml::from_str::<EnvironmentFile>(&content)
                    {
                        envs.push(env);
                    }
                }
            }
        }
    }

    envs.sort_by(|a, b| a.name.cmp(&b.name));
    Json(envs)
}

/// `GET /api/environments/:name` — Get a specific
/// environment.
async fn get_environment(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    let path = env_dir(&state).join(format!("{name}.yaml"));
    let content = std::fs::read_to_string(&path)
        .map_err(|_| StatusCode::NOT_FOUND)?;
    let env: EnvironmentFile =
        serde_yaml::from_str(&content).map_err(|e| {
            error!("Failed to parse environment file: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    Ok(Json(env))
}

/// `PUT /api/environments/:name` — Create or update an
/// environment.
async fn save_environment(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    Json(payload): Json<EnvironmentPayload>,
) -> Result<impl IntoResponse, StatusCode> {
    let dir = env_dir(&state);
    std::fs::create_dir_all(&dir).map_err(|e| {
        error!("Failed to create environments dir: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let env_file = EnvironmentFile {
        name: name.clone(),
        variables: payload.variables,
        sensitive_keys: payload.sensitive_keys,
    };

    let yaml = serde_yaml::to_string(&env_file).map_err(|e| {
        error!("Failed to serialize environment: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let path = dir.join(format!("{name}.yaml"));
    let is_new = !path.exists();

    std::fs::write(&path, &yaml).map_err(|e| {
        error!("Failed to write environment file: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    if is_new {
        Ok((StatusCode::CREATED, Json(env_file)))
    } else {
        Ok((StatusCode::OK, Json(env_file)))
    }
}

/// `DELETE /api/environments/:name` — Delete an environment
/// file.
async fn delete_environment(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    let path = env_dir(&state).join(format!("{name}.yaml"));

    if !path.exists() {
        return Err(StatusCode::NOT_FOUND);
    }

    std::fs::remove_file(&path).map_err(|e| {
        error!("Failed to delete environment file: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(StatusCode::NO_CONTENT)
}
