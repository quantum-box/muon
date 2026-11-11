//! Web server module for `muon serve` mode.
//!
//! Provides a REST API and SSE streaming endpoint for
//! running and monitoring test scenarios from a web UI.
//! The frontend is embedded into the binary via `rust-embed`.

pub mod environments;
pub mod hooks;
pub mod jobs;
pub mod metrics;
pub mod routes;
pub mod security;
pub mod sse;
pub mod state;
pub mod tachyon_login;
pub mod validation;
pub mod watcher;

use axum::http::{header, StatusCode};
use axum::middleware;
use axum::response::{Html, IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use rust_embed::Embed;
use security::ServeSecurity;
use state::AppState;
use std::sync::Arc;

#[derive(Embed)]
#[folder = "ui/dist"]
struct Asset;

/// Build the axum [`Router`] for local use: same-origin requests only,
/// no bearer token.
pub fn create_router(state: Arc<AppState>) -> Router {
    create_router_with_security(state, ServeSecurity::default())
}

/// Build the axum [`Router`] with all API routes guarded by `security`.
///
/// No CORS layer is installed: the UI is served from the same origin,
/// and the API must not be readable or callable from other sites.
pub fn create_router_with_security(
    state: Arc<AppState>,
    security: ServeSecurity,
) -> Router {
    let login = security.login();
    let api = Router::new()
        .merge(routes::api_routes())
        .merge(environments::env_routes())
        .merge(validation::validation_routes())
        .merge(metrics::metrics_routes())
        .merge(hooks::hooks_routes())
        .merge(jobs::jobs_routes())
        .route_layer(middleware::from_fn_with_state(
            Arc::new(security),
            security::guard,
        ));

    Router::new()
        .route("/health", get(health))
        .nest("/api", api)
        .with_state(state)
        .merge(tachyon_login::login_routes(login))
        .fallback(static_handler)
}

async fn health() -> &'static str {
    "ok"
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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use tower::ServiceExt;

    fn router(security: ServeSecurity) -> Router {
        let dir = tempfile::tempdir().unwrap().keep();
        create_router_with_security(AppState::new(dir), security)
    }

    async fn status(router: Router, request: Request<Body>) -> StatusCode {
        router.oneshot(request).await.unwrap().status()
    }

    fn validate(headers: &[(&str, &str)]) -> Request<Body> {
        let mut builder = Request::post("/api/validate")
            .header("host", "127.0.0.1:9800")
            .header("content-type", "application/json");
        for (k, v) in headers {
            builder = builder.header(*k, *v);
        }
        builder.body(Body::from(r#"{"yaml":"name: x"}"#)).unwrap()
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn api_rejects_cross_origin_requests() {
        let response = router(ServeSecurity::default())
            .oneshot(validate(&[("origin", "https://attacker.example")]))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert!(response
            .headers()
            .get("access-control-allow-origin")
            .is_none());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn api_requires_token_when_configured() {
        let secured = || {
            router(ServeSecurity::with_api_token(Some(
                "t0ken-value".into(),
            )))
        };
        assert_eq!(
            status(secured(), validate(&[])).await,
            StatusCode::UNAUTHORIZED
        );
        assert_ne!(
            status(
                secured(),
                validate(&[("authorization", "Bearer t0ken-value")])
            )
            .await,
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn health_stays_open() {
        let request = Request::get("/health").body(Body::empty()).unwrap();
        let secured = router(ServeSecurity::with_api_token(Some(
            "t0ken-value".into(),
        )));
        assert_eq!(status(secured, request).await, StatusCode::OK);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn environment_routes_match_names_and_reject_traversal() {
        let get = |path: &str| {
            Request::get(path)
                .header("host", "127.0.0.1:9800")
                .body(Body::empty())
                .unwrap()
        };
        // A by-name route that matched would return 404 for a missing
        // file; a literal `{name}` segment would fall through to the SPA.
        let missing = router(ServeSecurity::default())
            .oneshot(get("/api/environments/staging"))
            .await
            .unwrap();
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            status(
                router(ServeSecurity::default()),
                get("/api/environments/..%2F..%2Fsecret")
            )
            .await,
            StatusCode::BAD_REQUEST
        );
    }

    fn login_security() -> ServeSecurity {
        ServeSecurity::new(
            None,
            Some(Arc::new(
                tachyon_login::TachyonLogin::new(
                    "https://api.example.test".into(),
                    "client-1".into(),
                    "secret-1".into(),
                    None,
                )
                .unwrap(),
            )),
        )
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn api_accepts_a_login_session_and_points_others_to_login() {
        let security = login_security();
        let cookie = security.login().unwrap().test_session_cookie("us_1");
        let response = router(security.clone())
            .oneshot(validate(&[]))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        let body = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .unwrap();
        let body: serde_json::Value =
            serde_json::from_slice(&body).unwrap();
        assert_eq!(body["login_url"], "/.tachyon/auth/login");
        assert_ne!(
            status(router(security), validate(&[("cookie", &cookie)]))
                .await,
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn login_redirects_to_tachyon_with_pkce() {
        let request = Request::get("/.tachyon/auth/login?return_to=/runs")
            .header("host", "muon.example.test")
            .body(Body::empty())
            .unwrap();
        let response =
            router(login_security()).oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::FOUND);
        let location = response.headers()["location"].to_str().unwrap();
        let url = url::Url::parse(location).unwrap();
        assert_eq!(
            url.origin().ascii_serialization(),
            "https://api.example.test"
        );
        assert_eq!(url.path(), "/oauth2/authorize");
        let q: std::collections::HashMap<_, _> =
            url.query_pairs().collect();
        assert_eq!(q["client_id"], "client-1");
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(
            q["redirect_uri"],
            "https://muon.example.test/.tachyon/auth/callback"
        );
        assert!(!q["state"].is_empty() && !q["code_challenge"].is_empty());
        let cookie = response.headers()["set-cookie"].to_str().unwrap();
        assert!(cookie.starts_with("muon_login_flow="));
        assert!(cookie.contains("HttpOnly") && cookie.contains("Secure"));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn callback_without_matching_flow_is_refused() {
        let request =
            Request::get("/.tachyon/auth/callback?code=c&state=s")
                .header("host", "muon.example.test")
                .body(Body::empty())
                .unwrap();
        assert_eq!(
            status(router(login_security()), request).await,
            StatusCode::BAD_REQUEST
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn login_routes_are_absent_without_configuration() {
        let request = Request::get("/.tachyon/auth/me")
            .header("host", "127.0.0.1:9800")
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            status(router(ServeSecurity::default()), request).await,
            StatusCode::NOT_FOUND
        );
    }
}
