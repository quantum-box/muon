//! Tachyon login for `muon serve`.
//!
//! muon signs users in against the Tachyon OAuth 2.0 authorization server
//! with the authorization code flow and PKCE, as a confidential client
//! (`TACHYON_ISSUER`, `TACHYON_CLIENT_ID`, `TACHYON_CLIENT_SECRET`, the
//! same variables the Cloud App SDK uses). After the code exchange the
//! user is read from `/oauth2/userinfo`, and the session is kept in a
//! signed, host-only cookie so it works across server instances.
//!
//! Routes (always mounted; they answer `404` when login is not
//! configured):
//! - `GET  /.tachyon/auth/login?return_to=/path`
//! - `GET  /.tachyon/auth/callback`
//! - `GET  /.tachyon/auth/me`
//! - `POST /.tachyon/auth/logout`

use anyhow::{anyhow, Result};
use axum::extract::{Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Json, Response};
use axum::routing::{get, post};
use axum::Router;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Arc;

/// Path prefix of the login routes.
pub const AUTH_PREFIX: &str = "/.tachyon/auth";
/// Path the authorization server redirects back to.
pub const CALLBACK_PATH: &str = "/.tachyon/auth/callback";
/// Path the UI sends a signed-out user to.
pub const LOGIN_PATH: &str = "/.tachyon/auth/login";

const SESSION_COOKIE: &str = "muon_session";
const FLOW_COOKIE: &str = "muon_login_flow";
const SESSION_TTL_SECS: i64 = 8 * 60 * 60;
const FLOW_TTL_SECS: i64 = 10 * 60;
const LOGIN_SCOPE: &str = "openid email profile";

type HmacSha256 = Hmac<Sha256>;

/// The signed-in user carried by the session cookie.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionUser {
    pub sub: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct SessionClaims {
    #[serde(flatten)]
    user: SessionUser,
    exp: i64,
}

#[derive(Serialize, Deserialize)]
struct FlowClaims {
    state: String,
    verifier: String,
    return_to: String,
    exp: i64,
}

/// Tachyon login configuration.
pub struct TachyonLogin {
    issuer: String,
    client_id: String,
    client_secret: String,
    public_url: Option<String>,
    key: Vec<u8>,
    http: reqwest::Client,
}

impl std::fmt::Debug for TachyonLogin {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TachyonLogin")
            .field("issuer", &self.issuer)
            .field("client_id", &self.client_id)
            .finish_non_exhaustive()
    }
}

impl TachyonLogin {
    /// Build from `TACHYON_ISSUER`, `TACHYON_CLIENT_ID` and
    /// `TACHYON_CLIENT_SECRET` (and optional `MUON_PUBLIC_URL`). Returns
    /// `None` when none of the three is set, and an error when only some
    /// are.
    pub fn from_env() -> Result<Option<Self>> {
        let read = |key: &str| {
            std::env::var(key).ok().filter(|value| !value.is_empty())
        };
        match (
            read("TACHYON_ISSUER"),
            read("TACHYON_CLIENT_ID"),
            read("TACHYON_CLIENT_SECRET"),
        ) {
            (None, None, None) => Ok(None),
            (Some(issuer), Some(client_id), Some(client_secret)) => {
                Self::new(
                    issuer,
                    client_id,
                    client_secret,
                    read("MUON_PUBLIC_URL"),
                )
                .map(Some)
            }
            _ => Err(anyhow!(
                "Tachyon login needs TACHYON_ISSUER, TACHYON_CLIENT_ID and \
                 TACHYON_CLIENT_SECRET together"
            )),
        }
    }

    /// Create a login configuration. `issuer` must be an https URL, or
    /// http on localhost.
    pub fn new(
        issuer: String,
        client_id: String,
        client_secret: String,
        public_url: Option<String>,
    ) -> Result<Self> {
        let issuer = issuer.trim_end_matches('/').to_string();
        let parsed = url::Url::parse(&issuer)
            .map_err(|e| anyhow!("TACHYON_ISSUER is not a URL: {e}"))?;
        let local = matches!(
            parsed.host_str(),
            Some("localhost" | "127.0.0.1" | "[::1]")
        );
        if parsed.scheme() != "https"
            && !(parsed.scheme() == "http" && local)
        {
            return Err(anyhow!("TACHYON_ISSUER must use https"));
        }
        // The session key is derived from the client secret, so rotating
        // the client also ends every session.
        let mut mac = HmacSha256::new_from_slice(client_secret.as_bytes())
            .map_err(|e| anyhow!("invalid client secret: {e}"))?;
        mac.update(b"muon-session-v1");
        let key = mac.finalize().into_bytes().to_vec();
        Ok(Self {
            issuer,
            client_id,
            client_secret,
            public_url: public_url
                .map(|u| u.trim_end_matches('/').to_string()),
            key,
            http: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(std::time::Duration::from_secs(15))
                .build()?,
        })
    }

    /// The user of a valid, unexpired session cookie in `headers`.
    pub fn session_user(&self, headers: &HeaderMap) -> Option<SessionUser> {
        let value = cookie(headers, SESSION_COOKIE)?;
        let claims: SessionClaims = self.open(&value)?;
        (claims.exp > now()).then_some(claims.user)
    }

    /// A session cookie header value for `sub`, for tests.
    #[cfg(test)]
    pub(crate) fn test_session_cookie(&self, sub: &str) -> String {
        let sealed = self.seal(&SessionClaims {
            user: SessionUser {
                sub: sub.into(),
                email: None,
            },
            exp: now() + 60,
        });
        format!("{SESSION_COOKIE}={sealed}")
    }

    fn seal<T: Serialize>(&self, claims: &T) -> String {
        let payload = URL_SAFE_NO_PAD
            .encode(serde_json::to_vec(claims).unwrap_or_default());
        let signature =
            URL_SAFE_NO_PAD.encode(self.sign(payload.as_bytes()));
        format!("{payload}.{signature}")
    }

    fn open<T: for<'de> Deserialize<'de>>(
        &self,
        sealed: &str,
    ) -> Option<T> {
        let (payload, signature) = sealed.split_once('.')?;
        let signature = URL_SAFE_NO_PAD.decode(signature).ok()?;
        let mut mac = HmacSha256::new_from_slice(&self.key).ok()?;
        mac.update(payload.as_bytes());
        mac.verify_slice(&signature).ok()?;
        serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload).ok()?).ok()
    }

    fn sign(&self, data: &[u8]) -> Vec<u8> {
        let mut mac = HmacSha256::new_from_slice(&self.key)
            .expect("HMAC accepts any key length");
        mac.update(data);
        mac.finalize().into_bytes().to_vec()
    }

    fn base_url(&self, headers: &HeaderMap) -> Option<String> {
        if let Some(url) = &self.public_url {
            return Some(url.clone());
        }
        let host = headers.get(header::HOST)?.to_str().ok()?;
        let local = host.starts_with("localhost")
            || host.starts_with("127.0.0.1")
            || host.starts_with("[::1]");
        let scheme = if local { "http" } else { "https" };
        Some(format!("{scheme}://{host}"))
    }

    fn redirect_uri(&self, headers: &HeaderMap) -> Option<String> {
        self.base_url(headers)
            .map(|base| format!("{base}{CALLBACK_PATH}"))
    }

    async fn redeem(
        &self,
        code: &str,
        verifier: &str,
        redirect_uri: &str,
    ) -> Result<SessionUser> {
        #[derive(Deserialize)]
        struct TokenAnswer {
            access_token: String,
        }
        let body = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("grant_type", "authorization_code")
            .append_pair("code", code)
            .append_pair("redirect_uri", redirect_uri)
            .append_pair("client_id", &self.client_id)
            .append_pair("client_secret", &self.client_secret)
            .append_pair("code_verifier", verifier)
            .finish();
        let answer = self
            .http
            .post(format!("{}/oauth2/token", self.issuer))
            .header(
                header::CONTENT_TYPE,
                "application/x-www-form-urlencoded",
            )
            .body(body)
            .send()
            .await?;
        if !answer.status().is_success() {
            return Err(anyhow!(
                "token endpoint answered {}",
                answer.status()
            ));
        }
        let token: TokenAnswer = answer.json().await?;
        // The token came straight from the issuer's token endpoint over
        // TLS, so the userinfo answer for it identifies the user.
        let info = self
            .http
            .get(format!("{}/oauth2/userinfo", self.issuer))
            .bearer_auth(&token.access_token)
            .send()
            .await?;
        if !info.status().is_success() {
            return Err(anyhow!(
                "userinfo endpoint answered {}",
                info.status()
            ));
        }
        let user: SessionUser = info.json().await?;
        if user.sub.is_empty() {
            return Err(anyhow!("userinfo returned no subject"));
        }
        Ok(user)
    }
}

/// Login routes. Every route answers `404` when `login` is `None`.
pub fn login_routes(login: Option<Arc<TachyonLogin>>) -> Router {
    Router::new()
        .route(LOGIN_PATH, get(start_login))
        .route(CALLBACK_PATH, get(finish_login))
        .route("/.tachyon/auth/me", get(me))
        .route("/.tachyon/auth/logout", post(logout))
        .with_state(login)
}

#[derive(Deserialize)]
struct LoginQuery {
    return_to: Option<String>,
}

async fn start_login(
    State(login): State<Option<Arc<TachyonLogin>>>,
    headers: HeaderMap,
    Query(query): Query<LoginQuery>,
) -> Response {
    let Some(login) = login else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Some(redirect_uri) = login.redirect_uri(&headers) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let flow = FlowClaims {
        state: random_token(),
        verifier: random_token(),
        return_to: safe_return_to(query.return_to.as_deref()),
        exp: now() + FLOW_TTL_SECS,
    };
    let challenge =
        URL_SAFE_NO_PAD.encode(Sha256::digest(flow.verifier.as_bytes()));
    let mut authorize = match url::Url::parse(&format!(
        "{}/oauth2/authorize",
        login.issuer
    )) {
        Ok(url) => url,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    authorize
        .query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", &login.client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("scope", LOGIN_SCOPE)
        .append_pair("state", &flow.state)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256");
    let secure = redirect_uri.starts_with("https://");
    let mut response = redirect(authorize.as_str());
    set_cookie(
        &mut response,
        FLOW_COOKIE,
        &login.seal(&flow),
        AUTH_PREFIX,
        FLOW_TTL_SECS,
        secure,
    );
    response
}

#[derive(Deserialize)]
struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
}

async fn finish_login(
    State(login): State<Option<Arc<TachyonLogin>>>,
    headers: HeaderMap,
    Query(query): Query<CallbackQuery>,
) -> Response {
    let Some(login) = login else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let flow: Option<FlowClaims> =
        cookie(&headers, FLOW_COOKIE).and_then(|v| login.open(&v));
    let (Some(flow), Some(code), Some(state)) =
        (flow, query.code, query.state)
    else {
        return (StatusCode::BAD_REQUEST, "Login could not be completed")
            .into_response();
    };
    if flow.exp <= now()
        || !constant_time_eq(flow.state.as_bytes(), state.as_bytes())
    {
        return (StatusCode::BAD_REQUEST, "Login could not be completed")
            .into_response();
    }
    let Some(redirect_uri) = login.redirect_uri(&headers) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let user =
        match login.redeem(&code, &flow.verifier, &redirect_uri).await {
            Ok(user) => user,
            Err(error) => {
                tracing::warn!(%error, "Tachyon login failed");
                return (
                    StatusCode::BAD_GATEWAY,
                    "Login could not be completed",
                )
                    .into_response();
            }
        };
    let secure = redirect_uri.starts_with("https://");
    let mut response = redirect(&flow.return_to);
    set_cookie(
        &mut response,
        SESSION_COOKIE,
        &login.seal(&SessionClaims {
            user,
            exp: now() + SESSION_TTL_SECS,
        }),
        "/",
        SESSION_TTL_SECS,
        secure,
    );
    set_cookie(&mut response, FLOW_COOKIE, "", AUTH_PREFIX, 0, secure);
    response
}

async fn me(
    State(login): State<Option<Arc<TachyonLogin>>>,
    headers: HeaderMap,
) -> Response {
    let Some(login) = login else {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "login_enabled": false })),
        )
            .into_response();
    };
    match login.session_user(&headers) {
        Some(user) => Json(user).into_response(),
        None => login_required(),
    }
}

async fn logout(
    State(login): State<Option<Arc<TachyonLogin>>>,
    headers: HeaderMap,
) -> Response {
    if login.is_none() {
        return StatusCode::NOT_FOUND.into_response();
    }
    let public_origin = login
        .as_ref()
        .and_then(|l| l.public_url.as_deref())
        .and_then(super::security::origin_of);
    if super::security::is_cross_origin(&headers, public_origin.as_deref())
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    let secure = login
        .as_ref()
        .and_then(|l| l.redirect_uri(&headers))
        .is_some_and(|uri| uri.starts_with("https://"));
    let mut response = StatusCode::NO_CONTENT.into_response();
    set_cookie(&mut response, SESSION_COOKIE, "", "/", 0, secure);
    response
}

/// `401` that tells the UI where to sign in.
pub fn login_required() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(serde_json::json!({
            "error": "login_required",
            "login_url": LOGIN_PATH,
        })),
    )
        .into_response()
}

/// Only same-site paths are allowed as the post-login destination.
fn safe_return_to(value: Option<&str>) -> String {
    match value {
        Some(path)
            if path.starts_with('/')
                && !path.starts_with("//")
                && !path.starts_with("/\\")
                && !path.contains(['\r', '\n']) =>
        {
            path.to_string()
        }
        _ => "/".to_string(),
    }
}

fn redirect(location: &str) -> Response {
    let mut response = StatusCode::FOUND.into_response();
    if let Ok(value) = HeaderValue::from_str(location) {
        response.headers_mut().insert(header::LOCATION, value);
    }
    response
}

fn set_cookie(
    response: &mut Response,
    name: &str,
    value: &str,
    path: &str,
    max_age: i64,
    secure: bool,
) {
    let secure = if secure { "; Secure" } else { "" };
    let cookie = format!(
        "{name}={value}; Path={path}; Max-Age={max_age}; HttpOnly; SameSite=Lax{secure}"
    );
    if let Ok(value) = HeaderValue::from_str(&cookie) {
        response.headers_mut().append(header::SET_COOKIE, value);
    }
}

fn cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(key, _)| *key == name)
        .map(|(_, value)| value.to_string())
}

fn random_token() -> String {
    let mut bytes = Vec::with_capacity(32);
    bytes.extend_from_slice(uuid::Uuid::new_v4().as_bytes());
    bytes.extend_from_slice(uuid::Uuid::new_v4().as_bytes());
    URL_SAFE_NO_PAD.encode(bytes)
}

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len()
        && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(crate) fn login() -> TachyonLogin {
        TachyonLogin::new(
            "https://api.example.test".into(),
            "client-1".into(),
            "secret-1".into(),
            None,
        )
        .unwrap()
    }

    fn with_cookie(name: &str, value: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            HeaderValue::from_str(&format!("other=1; {name}={value}"))
                .unwrap(),
        );
        headers
    }

    #[test]
    fn session_cookie_round_trips_and_rejects_tampering() {
        let login = login();
        let user = SessionUser {
            sub: "us_1".into(),
            email: Some("a@example.test".into()),
        };
        let sealed = login.seal(&SessionClaims {
            user: user.clone(),
            exp: now() + 60,
        });
        assert_eq!(
            login.session_user(&with_cookie(SESSION_COOKIE, &sealed)),
            Some(user)
        );

        let (payload, signature) = sealed.split_once('.').unwrap();
        let forged = format!(
            "{}.{signature}",
            URL_SAFE_NO_PAD
                .encode(br#"{"sub":"us_admin","exp":9999999999}"#)
        );
        assert_eq!(
            login.session_user(&with_cookie(SESSION_COOKIE, &forged)),
            None
        );
        let other = TachyonLogin::new(
            "https://api.example.test".into(),
            "client-1".into(),
            "another-secret".into(),
            None,
        )
        .unwrap();
        assert_eq!(
            other.session_user(&with_cookie(SESSION_COOKIE, &sealed)),
            None
        );
        assert!(!payload.is_empty());
    }

    #[test]
    fn expired_session_is_rejected() {
        let login = login();
        let sealed = login.seal(&SessionClaims {
            user: SessionUser {
                sub: "us_1".into(),
                email: None,
            },
            exp: now() - 1,
        });
        assert_eq!(
            login.session_user(&with_cookie(SESSION_COOKIE, &sealed)),
            None
        );
    }

    #[test]
    fn return_to_stays_on_this_site() {
        assert_eq!(
            safe_return_to(Some("/scenarios?x=1")),
            "/scenarios?x=1"
        );
        assert_eq!(safe_return_to(Some("//evil.example")), "/");
        assert_eq!(safe_return_to(Some("/\\evil.example")), "/");
        assert_eq!(safe_return_to(Some("https://evil.example")), "/");
        assert_eq!(safe_return_to(None), "/");
    }

    #[test]
    fn redirect_uri_uses_public_url_over_rewritten_host() {
        let login = TachyonLogin::new(
            "https://api.example.test".into(),
            "c".into(),
            "s".into(),
            Some("https://muon.example/".into()),
        )
        .unwrap();
        let mut headers = HeaderMap::new();
        headers.insert(
            header::HOST,
            HeaderValue::from_static(
                "abc.lambda-url.ap-northeast-1.on.aws",
            ),
        );
        assert_eq!(
            login.redirect_uri(&headers).as_deref(),
            Some("https://muon.example/.tachyon/auth/callback")
        );
    }

    #[test]
    fn issuer_must_use_https() {
        assert!(TachyonLogin::new(
            "http://api.example.test".into(),
            "c".into(),
            "s".into(),
            None
        )
        .is_err());
        assert!(TachyonLogin::new(
            "http://localhost:50054".into(),
            "c".into(),
            "s".into(),
            None
        )
        .is_ok());
    }
}
