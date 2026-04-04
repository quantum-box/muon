//! Web server module for `muon serve` mode.
//!
//! Provides a local REST API and SSE streaming endpoint for
//! running and monitoring test scenarios from a web UI.
//! The frontend is embedded into the binary via `rust-embed`.

pub mod environments;
pub mod hooks;
pub mod metrics;
pub mod routes;
pub mod sse;
pub mod state;
pub mod validation;
pub mod watcher;

use axum::http::{header, StatusCode};
use axum::response::{Html, IntoResponse, Response};
use axum::Router;
use rust_embed::Embed;
use state::AppState;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};

#[derive(Embed)]
#[folder = "ui/dist"]
struct Asset;

/// Build the axum [`Router`] with all API routes and middleware.
pub fn create_router(state: Arc<AppState>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .nest("/api", routes::api_routes())
        .nest("/api", environments::env_routes())
        .nest("/api", validation::validation_routes())
        .nest("/api", metrics::metrics_routes())
        .nest("/api", hooks::hooks_routes())
        .with_state(state)
        .layer(cors)
        .fallback(static_handler)
}

async fn static_handler(uri: axum::http::Uri) -> impl IntoResponse {
    let path = uri.path().trim_start_matches('/');

    // Try exact file match first
    if !path.is_empty() {
        if let Some(file) = Asset::get(path) {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            return Response::builder()
                .header(header::CONTENT_TYPE, mime.as_ref())
                .body(axum::body::Body::from(file.data.to_vec()))
                .unwrap()
                .into_response();
        }
    }

    // SPA fallback: serve index.html for all other routes
    match Asset::get("index.html") {
        Some(file) => Html(String::from_utf8_lossy(&file.data).to_string())
            .into_response(),
        None => {
            (StatusCode::NOT_FOUND, "Frontend not found").into_response()
        }
    }
}
