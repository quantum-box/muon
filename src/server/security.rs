//! Request guard for the `muon serve` API.
//!
//! The API can create and run scenarios that send requests (and
//! environment values) to arbitrary URLs, so every `/api` request must
//! come from the same origin as the served UI, and must carry the
//! configured bearer token when one is set.

use axum::extract::{Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use std::sync::Arc;

/// Access policy for the serve-mode API.
#[derive(Clone, Debug, Default)]
pub struct ServeSecurity {
    api_token: Option<String>,
}

impl ServeSecurity {
    /// Policy that requires `Authorization: Bearer <token>` on every
    /// API request. An empty token disables the requirement.
    pub fn with_api_token(token: Option<String>) -> Self {
        Self {
            api_token: token.filter(|t| !t.is_empty()),
        }
    }

    /// Whether API requests must carry a bearer token.
    pub fn requires_token(&self) -> bool {
        self.api_token.is_some()
    }

    fn check(&self, headers: &HeaderMap) -> Result<(), StatusCode> {
        if is_cross_origin(headers) {
            return Err(StatusCode::FORBIDDEN);
        }
        if let Some(expected) = &self.api_token {
            let presented = headers
                .get(header::AUTHORIZATION)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.strip_prefix("Bearer "))
                .unwrap_or("");
            if !constant_time_eq(presented.as_bytes(), expected.as_bytes())
            {
                return Err(StatusCode::UNAUTHORIZED);
            }
        }
        Ok(())
    }
}

/// Middleware that enforces [`ServeSecurity`] on the wrapped routes.
pub async fn guard(
    State(security): State<Arc<ServeSecurity>>,
    request: Request,
    next: Next,
) -> Response {
    match security.check(request.headers()) {
        Ok(()) => next.run(request).await,
        Err(status) => status.into_response(),
    }
}

/// A browser request is cross-origin when it says so, or when its
/// `Origin` does not name the host it was sent to. Requests without an
/// `Origin` (CLI tools, server-to-server hooks) are not browser
/// cross-site requests and are left to the token check.
fn is_cross_origin(headers: &HeaderMap) -> bool {
    if headers
        .get("sec-fetch-site")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|site| site == "cross-site")
    {
        return true;
    }
    let Some(origin) = headers.get(header::ORIGIN) else {
        return false;
    };
    let Some(host) =
        headers.get(header::HOST).and_then(|v| v.to_str().ok())
    else {
        return true;
    };
    match origin.to_str().ok().and_then(|o| url::Url::parse(o).ok()) {
        Some(url) => {
            let origin_host = match (url.host_str(), url.port()) {
                (Some(h), Some(p)) => format!("{h}:{p}"),
                (Some(h), None) => h.to_string(),
                _ => return true,
            };
            !origin_host.eq_ignore_ascii_case(host)
        }
        None => true,
    }
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn headers(pairs: &[(&'static str, &str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (k, v) in pairs {
            map.insert(*k, HeaderValue::from_str(v).unwrap());
        }
        map
    }

    #[test]
    fn rejects_cross_origin_browser_requests() {
        let local = ServeSecurity::default();
        let h = headers(&[
            ("host", "127.0.0.1:9800"),
            ("origin", "https://attacker.example"),
        ]);
        assert_eq!(local.check(&h), Err(StatusCode::FORBIDDEN));
        let h = headers(&[
            ("host", "127.0.0.1:9800"),
            ("sec-fetch-site", "cross-site"),
        ]);
        assert_eq!(local.check(&h), Err(StatusCode::FORBIDDEN));
        let h = headers(&[("host", "127.0.0.1:9800"), ("origin", "null")]);
        assert_eq!(local.check(&h), Err(StatusCode::FORBIDDEN));
    }

    #[test]
    fn allows_same_origin_and_originless_requests() {
        let local = ServeSecurity::default();
        let h = headers(&[
            ("host", "127.0.0.1:9800"),
            ("origin", "http://127.0.0.1:9800"),
        ]);
        assert_eq!(local.check(&h), Ok(()));
        let h = headers(&[("host", "127.0.0.1:9800")]);
        assert_eq!(local.check(&h), Ok(()));
    }

    #[test]
    fn requires_matching_bearer_token_when_configured() {
        let sec =
            ServeSecurity::with_api_token(Some("s3cret-token".into()));
        let h = headers(&[("host", "muon.example")]);
        assert_eq!(sec.check(&h), Err(StatusCode::UNAUTHORIZED));
        let h = headers(&[
            ("host", "muon.example"),
            ("authorization", "Bearer wrong"),
        ]);
        assert_eq!(sec.check(&h), Err(StatusCode::UNAUTHORIZED));
        let h = headers(&[
            ("host", "muon.example"),
            ("authorization", "Bearer s3cret-token"),
        ]);
        assert_eq!(sec.check(&h), Ok(()));
    }

    #[test]
    fn empty_token_does_not_enable_auth() {
        assert!(!ServeSecurity::with_api_token(Some(String::new()))
            .requires_token());
    }
}
