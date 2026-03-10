//! Web server module for `muon serve` mode.
//!
//! Provides a local REST API and SSE streaming endpoint for
//! running and monitoring test scenarios from a web UI.

pub mod routes;
pub mod sse;
pub mod state;
pub mod watcher;

use axum::Router;
use state::AppState;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};

/// Build the axum [`Router`] with all API routes and middleware.
pub fn create_router(state: Arc<AppState>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .nest("/api", routes::api_routes())
        .with_state(state)
        .layer(cors)
}
