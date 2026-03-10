//! YAML validation API handler.
//!
//! Accepts a raw YAML string, attempts to parse it as a
//! [`TestScenario`], and returns structured validation
//! results with line-level error information.

use crate::model::TestScenario;
use crate::server::state::AppState;
use axum::extract::State;
use axum::response::IntoResponse;
use axum::routing::post;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// Build the validation API sub-router.
pub fn validation_routes() -> Router<Arc<AppState>> {
    Router::new().route("/validate", post(validate_yaml))
}

/// Request body for the validate endpoint.
#[derive(Debug, Deserialize)]
struct ValidateRequest {
    yaml: String,
}

/// Validation result returned to the client.
#[derive(Debug, Serialize)]
struct ValidationResult {
    valid: bool,
    errors: Vec<ValidationError>,
}

/// A single validation error with location info.
#[derive(Debug, Serialize)]
struct ValidationError {
    line: Option<usize>,
    column: Option<usize>,
    message: String,
}

/// `POST /api/validate` — Validate a YAML string as a
/// scenario.
async fn validate_yaml(
    State(_state): State<Arc<AppState>>,
    Json(req): Json<ValidateRequest>,
) -> impl IntoResponse {
    match serde_yaml::from_str::<TestScenario>(&req.yaml) {
        Ok(_) => Json(ValidationResult {
            valid: true,
            errors: Vec::new(),
        }),
        Err(e) => {
            let location = e.location();
            let error = ValidationError {
                line: location.as_ref().map(|l| l.line()),
                column: location.as_ref().map(|l| l.column()),
                message: e.to_string(),
            };
            Json(ValidationResult {
                valid: false,
                errors: vec![error],
            })
        }
    }
}
