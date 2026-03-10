//! Parse Postman Collection v2.1 JSON into muon scenarios.

use anyhow::{Context, Result};
use muon::model::{
    HttpMethod, HttpRequest, ResponseExpectation, TestConfig,
    TestScenario, TestStep,
};
use serde::Deserialize;
use std::collections::HashMap;

// ── Postman v2.1 JSON model (subset) ──────────────────

#[derive(Debug, Deserialize)]
struct PostmanCollection {
    info: PostmanInfo,
    #[serde(default)]
    item: Vec<PostmanItem>,
    #[serde(default)]
    variable: Vec<PostmanVariable>,
}

#[derive(Debug, Deserialize)]
struct PostmanInfo {
    name: String,
    #[serde(default)]
    description: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum PostmanItem {
    Folder {
        name: String,
        #[serde(default)]
        item: Vec<PostmanItem>,
    },
    Request {
        name: String,
        request: PostmanRequest,
    },
}

#[derive(Debug, Deserialize)]
struct PostmanRequest {
    method: String,
    url: PostmanUrl,
    #[serde(default)]
    header: Vec<PostmanHeader>,
    #[serde(default)]
    body: Option<PostmanBody>,
    #[serde(default)]
    auth: Option<PostmanAuth>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum PostmanUrl {
    Simple(String),
    Structured {
        raw: String,
        #[serde(default)]
        host: Vec<String>,
        #[serde(default)]
        path: Vec<String>,
        #[serde(default)]
        query: Vec<PostmanQueryParam>,
    },
}

#[derive(Debug, Deserialize)]
struct PostmanQueryParam {
    key: String,
    #[serde(default)]
    value: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PostmanHeader {
    key: String,
    value: String,
}

#[derive(Debug, Deserialize)]
struct PostmanBody {
    #[serde(default)]
    mode: Option<String>,
    #[serde(default)]
    raw: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PostmanAuth {
    #[serde(rename = "type")]
    auth_type: String,
    #[serde(default)]
    bearer: Vec<PostmanAuthKv>,
    #[serde(default)]
    basic: Vec<PostmanAuthKv>,
    #[serde(default)]
    apikey: Vec<PostmanAuthKv>,
}

#[derive(Debug, Deserialize)]
struct PostmanAuthKv {
    key: String,
    value: String,
}

#[derive(Debug, Deserialize)]
struct PostmanVariable {
    key: String,
    #[serde(default)]
    value: Option<String>,
}

// ── Public API ────────────────────────────────────────

/// Parse a Postman Collection v2.1 JSON string into muon
/// scenarios.
pub fn parse_collection(
    json_str: &str,
) -> Result<Vec<TestScenario>> {
    let collection: PostmanCollection =
        serde_json::from_str(json_str)
            .context("failed to parse Postman collection JSON")?;

    // Convert collection-level variables
    let mut vars = HashMap::new();
    for var in &collection.variable {
        if let Some(ref val) = var.value {
            vars.insert(
                var.key.clone(),
                serde_json::Value::String(val.clone()),
            );
        }
    }

    let mut steps = Vec::new();
    flatten_items(&collection.item, &mut steps);

    if steps.is_empty() {
        return Ok(Vec::new());
    }

    let scenario = TestScenario {
        name: collection.info.name.clone(),
        description: collection.info.description.clone(),
        tags: vec!["postman-import".to_string()],
        steps,
        vars,
        config: TestConfig::default(),
    };

    Ok(vec![scenario])
}

/// Recursively flatten folder items into a list of steps.
fn flatten_items(
    items: &[PostmanItem],
    out: &mut Vec<TestStep>,
) {
    for item in items {
        match item {
            PostmanItem::Folder { item, .. } => {
                flatten_items(item, out);
            }
            PostmanItem::Request { name, request } => {
                if let Ok(step) = convert_request(name, request) {
                    out.push(step);
                }
            }
        }
    }
}

/// Convert a single Postman request into a muon `TestStep`.
fn convert_request(
    name: &str,
    req: &PostmanRequest,
) -> Result<TestStep> {
    let method = parse_method(&req.method);

    let (url, query) = match &req.url {
        PostmanUrl::Simple(s) => {
            (s.clone(), HashMap::new())
        }
        PostmanUrl::Structured {
            raw, query: params, ..
        } => {
            let mut q = HashMap::new();
            for p in params {
                q.insert(
                    p.key.clone(),
                    p.value.clone().unwrap_or_default(),
                );
            }
            (raw.clone(), q)
        }
    };

    let mut headers: HashMap<String, String> = req
        .header
        .iter()
        .map(|h| (h.key.clone(), h.value.clone()))
        .collect();

    // Apply auth headers
    if let Some(auth) = &req.auth {
        apply_auth(auth, &mut headers);
    }

    let body = req
        .body
        .as_ref()
        .and_then(|b| b.raw.as_ref())
        .and_then(|raw| serde_json::from_str(raw).ok());

    Ok(TestStep {
        name: name.to_string(),
        id: None,
        description: None,
        request: HttpRequest {
            method,
            url,
            headers,
            query,
            body,
        },
        expect: ResponseExpectation {
            status: 200,
            headers: HashMap::new(),
            json: HashMap::new(),
            json_lengths: HashMap::new(),
            schema: None,
            contains: Vec::new(),
            json_eq: None,
            json_ignore_fields: Vec::new(),
            sse: None,
        },
        save: HashMap::new(),
        condition: None,
        test: None,
        bind: HashMap::new(),
        loop_config: None,
        include: None,
    })
}

fn parse_method(s: &str) -> HttpMethod {
    match s.to_uppercase().as_str() {
        "GET" => HttpMethod::Get,
        "POST" => HttpMethod::Post,
        "PUT" => HttpMethod::Put,
        "DELETE" => HttpMethod::Delete,
        "PATCH" => HttpMethod::Patch,
        "HEAD" => HttpMethod::Head,
        "OPTIONS" => HttpMethod::Options,
        _ => HttpMethod::Get,
    }
}

/// Inject auth information into headers.
fn apply_auth(
    auth: &PostmanAuth,
    headers: &mut HashMap<String, String>,
) {
    match auth.auth_type.as_str() {
        "bearer" => {
            if let Some(kv) =
                auth.bearer.iter().find(|kv| kv.key == "token")
            {
                headers.insert(
                    "Authorization".to_string(),
                    format!("Bearer {}", kv.value),
                );
            }
        }
        "basic" => {
            let user = auth
                .basic
                .iter()
                .find(|kv| kv.key == "username")
                .map(|kv| kv.value.as_str())
                .unwrap_or("");
            let pass = auth
                .basic
                .iter()
                .find(|kv| kv.key == "password")
                .map(|kv| kv.value.as_str())
                .unwrap_or("");
            use std::io::Write;
            let mut buf = Vec::new();
            write!(buf, "{user}:{pass}").unwrap();
            // Simple base64 without external dep. In Tauri
            // context we have access to the full runtime.
            let encoded = base64_encode(&buf);
            headers.insert(
                "Authorization".to_string(),
                format!("Basic {encoded}"),
            );
        }
        "apikey" => {
            let key = auth
                .apikey
                .iter()
                .find(|kv| kv.key == "key")
                .map(|kv| kv.value.as_str())
                .unwrap_or("X-Api-Key");
            let value = auth
                .apikey
                .iter()
                .find(|kv| kv.key == "value")
                .map(|kv| kv.value.clone())
                .unwrap_or_default();
            headers.insert(key.to_string(), value);
        }
        _ => {}
    }
}

/// Minimal base64 encoder (avoids extra dependency).
pub(crate) fn base64_encode(input: &[u8]) -> String {
    const CHARS: &[u8] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;

        out.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        out.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);

        if chunk.len() > 1 {
            out.push(
                CHARS[((triple >> 6) & 0x3F) as usize] as char,
            );
        } else {
            out.push('=');
        }

        if chunk.len() > 2 {
            out.push(CHARS[(triple & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}
