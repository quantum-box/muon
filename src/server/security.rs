//! Request guard for the `muon serve` API.
//!
//! The API can create and run scenarios that send requests (and
//! environment values) to arbitrary URLs, so every `/api` request must
//! come from the same origin as the served UI. When Tachyon login or an
//! API token is configured, it must also carry a login session or the
//! token.

use super::tachyon_login::{login_required, TachyonLogin};
use axum::extract::{Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use std::sync::Arc;

/// Access policy for the serve-mode API.
#[derive(Clone, Debug, Default)]
pub struct ServeSecurity {
    api_token: Option<String>,
    login: Option<Arc<TachyonLogin>>,
    locked: bool,
}

impl ServeSecurity {
    /// Policy that requires `Authorization: Bearer <token>` on every
    /// API request. An empty token disables the requirement.
    pub fn with_api_token(token: Option<String>) -> Self {
        Self::new(token, None)
    }

    /// Policy that accepts a Tachyon login session or the API token.
    /// With neither, the API is open to same-origin requests (local use).
    pub fn new(
        token: Option<String>,
        login: Option<Arc<TachyonLogin>>,
    ) -> Self {
        Self {
            api_token: token.filter(|t| !t.is_empty()),
            login,
            locked: false,
        }
    }

    /// Policy that refuses every API request. Used when the server is
    /// reachable from outside but no way to authenticate is configured.
    pub fn locked() -> Self {
        Self {
            locked: true,
            ..Self::default()
        }
    }

    /// Whether API requests must authenticate.
    pub fn requires_token(&self) -> bool {
        self.api_token.is_some() || self.login.is_some()
    }

    /// The configured Tachyon login, if any.
    pub fn login(&self) -> Option<Arc<TachyonLogin>> {
        self.login.clone()
    }

    fn check(&self, headers: &HeaderMap) -> Result<(), StatusCode> {
        if is_cross_origin(headers) {
            return Err(StatusCode::FORBIDDEN);
        }
        if self.locked {
            return Err(StatusCode::SERVICE_UNAVAILABLE);
        }
        if !self.requires_token() {
            return Ok(());
        }
        let token_ok = self.api_token.as_ref().is_some_and(|expected| {
            let presented = headers
                .get(header::AUTHORIZATION)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.strip_prefix("Bearer "))
                .unwrap_or("");
            constant_time_eq(presented.as_bytes(), expected.as_bytes())
        });
        let session_ok = self
            .login
            .as_ref()
            .is_some_and(|login| login.session_user(headers).is_some());
        if token_ok || session_ok {
            Ok(())
        } else {
            Err(StatusCode::UNAUTHORIZED)
        }
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
        Err(StatusCode::UNAUTHORIZED) if security.login.is_some() => {
            login_required()
        }
        Err(status) => status.into_response(),
    }
}

/// A browser request is cross-origin when it says so, or when its
/// `Origin` does not name the host it was sent to. Requests without an
/// `Origin` (CLI tools, server-to-server hooks) are not browser
/// cross-site requests and are left to the token check.
pub(crate) fn is_cross_origin(headers: &HeaderMap) -> bool {
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
    fn locked_policy_refuses_every_api_request() {
        let h = headers(&[("host", "muon.example")]);
        assert_eq!(
            ServeSecurity::locked().check(&h),
            Err(StatusCode::SERVICE_UNAVAILABLE)
        );
    }

    #[test]
    fn empty_token_does_not_enable_auth() {
        assert!(!ServeSecurity::with_api_token(Some(String::new()))
            .requires_token());
    }
}
