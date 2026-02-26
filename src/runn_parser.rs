//! Parser for runn-compatible runbook YAML files.
//!
//! Converts runn's runbook format into muon's internal
//! [`TestScenario`] model, enabling direct execution of runn
//! runbooks.

use crate::model::*;
use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use tracing::debug;

/// Top-level runn runbook structure.
#[derive(Debug, Deserialize)]
struct RunnRunbook {
    #[serde(default)]
    desc: Option<String>,

    #[serde(default)]
    labels: Vec<String>,

    #[serde(default)]
    runners: HashMap<String, Value>,

    #[serde(default)]
    vars: HashMap<String, Value>,

    #[serde(default)]
    steps: RunnSteps,

    #[serde(default)]
    #[allow(dead_code)]
    debug: bool,

    #[serde(default)]
    force: bool,
}

/// Steps can be either a list (ordered) or a map (named).
#[derive(Debug, Deserialize, Default)]
#[serde(untagged)]
enum RunnSteps {
    Map(serde_yaml::Mapping),
    List(Vec<serde_yaml::Value>),
    #[default]
    Empty,
}

#[derive(Debug, Deserialize, Default)]
struct RunnLoopConfig {
    #[serde(default)]
    count: Option<u32>,
    #[serde(default)]
    until: Option<String>,
    #[serde(default)]
    interval: Option<f64>,
    #[serde(default)]
    multiplier: Option<f64>,
    #[serde(default, rename = "maxInterval")]
    max_interval: Option<f64>,
}

/// Parse a runn-format runbook YAML string into a muon
/// TestScenario.
pub fn parse_runbook(yaml: &str) -> Result<TestScenario> {
    let runbook: RunnRunbook = serde_yaml::from_str(yaml)
        .context("Failed to parse runn runbook YAML")?;

    let base_url = find_http_runner_url(&runbook.runners);
    let name = runbook
        .desc
        .clone()
        .unwrap_or_else(|| "Untitled Runbook".to_string());

    let steps = convert_steps(&runbook, &base_url)?;

    let config = TestConfig {
        base_url,
        headers: HashMap::new(),
        timeout: 30,
        continue_on_failure: runbook.force,
    };

    Ok(TestScenario {
        name,
        description: runbook.desc,
        tags: runbook.labels,
        steps,
        vars: runbook.vars,
        config,
    })
}

/// Find the first HTTP runner URL from the runners map.
fn find_http_runner_url(
    runners: &HashMap<String, Value>,
) -> Option<String> {
    // Look for common HTTP runner keys
    for key in &["req", "http", "api"] {
        if let Some(Value::String(url)) = runners.get(*key) {
            return Some(url.clone());
        }
    }
    // Fall back to any string value that looks like a URL
    for value in runners.values() {
        if let Value::String(url) = value {
            if url.starts_with("http://") || url.starts_with("https://") {
                return Some(url.clone());
            }
        }
    }
    None
}

/// Convert runn steps (map or list) into muon TestStep vec.
fn convert_steps(
    runbook: &RunnRunbook,
    base_url: &Option<String>,
) -> Result<Vec<TestStep>> {
    let mut steps = Vec::new();

    match &runbook.steps {
        RunnSteps::Map(mapping) => {
            for (key, value) in mapping {
                let step_name =
                    key.as_str().unwrap_or("unnamed").to_string();
                let step = convert_single_step(&step_name, value, base_url)
                    .with_context(|| {
                        format!("Failed to convert step '{step_name}'")
                    })?;
                if let Some(s) = step {
                    steps.push(s);
                }
            }
        }
        RunnSteps::List(list) => {
            for (idx, value) in list.iter().enumerate() {
                let step_name = format!("step_{}", idx + 1);
                let step = convert_single_step(&step_name, value, base_url)
                    .with_context(|| {
                        format!(
                            "Failed to convert step at \
                                 index {idx}"
                        )
                    })?;
                if let Some(s) = step {
                    steps.push(s);
                }
            }
        }
        RunnSteps::Empty => {}
    }

    Ok(steps)
}

/// Convert a single runn step value into a muon TestStep.
fn convert_single_step(
    name: &str,
    value: &serde_yaml::Value,
    base_url: &Option<String>,
) -> Result<Option<TestStep>> {
    let mapping = match value.as_mapping() {
        Some(m) => m,
        None => return Ok(None),
    };

    // Extract req section
    let req_value =
        mapping.get(serde_yaml::Value::String("req".to_string()));

    let request = if let Some(req) = req_value {
        parse_runn_request(req, base_url)?
    } else {
        // Steps without req (e.g. bind-only, dump, etc.)
        // Create a dummy — or skip
        return Ok(None);
    };

    // Extract test expression
    let test = mapping
        .get(serde_yaml::Value::String("test".to_string()))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Extract bind
    let bind = mapping
        .get(serde_yaml::Value::String("bind".to_string()))
        .and_then(|v| v.as_mapping())
        .map(|m| {
            m.iter()
                .filter_map(|(k, v)| {
                    Some((k.as_str()?.to_string(), v.as_str()?.to_string()))
                })
                .collect()
        })
        .unwrap_or_default();

    // Extract desc
    let desc = mapping
        .get(serde_yaml::Value::String("desc".to_string()))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Extract loop
    let loop_config = mapping
        .get(serde_yaml::Value::String("loop".to_string()))
        .and_then(|v| {
            serde_yaml::from_value::<RunnLoopConfig>(v.clone()).ok()
        })
        .map(|lc| LoopConfig {
            count: lc.count.unwrap_or(3),
            until: lc.until,
            interval: lc.interval.unwrap_or(1.0),
            multiplier: lc.multiplier,
            max_interval: lc.max_interval,
        });

    // Determine expected status from test expression if
    // possible
    let expected_status =
        infer_status_from_test(test.as_deref()).unwrap_or(200);

    Ok(Some(TestStep {
        name: name.to_string(),
        id: Some(name.to_string()),
        description: desc,
        request,
        expect: ResponseExpectation {
            status: expected_status,
            headers: HashMap::new(),
            json: HashMap::new(),
            json_lengths: HashMap::new(),
            schema: None,
            contains: vec![],
            json_eq: None,
            json_ignore_fields: vec![],
            sse: None,
        },
        save: HashMap::new(),
        condition: None,
        test,
        bind,
        loop_config,
        include: None,
    }))
}

/// Parse runn's HTTP request format:
/// ```yaml
/// req:
///   /path:
///     post:
///       headers:
///         Content-Type: application/json
///       body:
///         application/json:
///           key: value
/// ```
fn parse_runn_request(
    req: &serde_yaml::Value,
    base_url: &Option<String>,
) -> Result<HttpRequest> {
    let mapping = req
        .as_mapping()
        .ok_or_else(|| anyhow!("req must be a mapping"))?;

    // The first key is the URL path
    let (path_value, method_mapping) = mapping
        .iter()
        .next()
        .ok_or_else(|| anyhow!("req mapping is empty"))?;

    let path = path_value
        .as_str()
        .ok_or_else(|| anyhow!("req path must be a string"))?;

    let url = if let Some(base) = base_url {
        if path.starts_with("http://") || path.starts_with("https://") {
            path.to_string()
        } else {
            format!("{}{}", base.trim_end_matches('/'), path)
        }
    } else {
        path.to_string()
    };

    let method_map = method_mapping
        .as_mapping()
        .ok_or_else(|| anyhow!("method definition must be a mapping"))?;

    // The key is the HTTP method (get, post, put, delete, etc.)
    let (method_value, details) = method_map
        .iter()
        .next()
        .ok_or_else(|| anyhow!("method mapping is empty"))?;

    let method_str = method_value
        .as_str()
        .ok_or_else(|| anyhow!("method must be a string"))?
        .to_uppercase();

    let method = match method_str.as_str() {
        "GET" => HttpMethod::Get,
        "POST" => HttpMethod::Post,
        "PUT" => HttpMethod::Put,
        "DELETE" => HttpMethod::Delete,
        "PATCH" => HttpMethod::Patch,
        "HEAD" => HttpMethod::Head,
        "OPTIONS" => HttpMethod::Options,
        _ => return Err(anyhow!("Unsupported HTTP method: {method_str}")),
    };

    // Parse headers and body from details
    let mut headers = HashMap::new();
    let mut body = None;

    if let Some(detail_map) = details.as_mapping() {
        // Headers
        if let Some(h) =
            detail_map.get(serde_yaml::Value::String("headers".to_string()))
        {
            if let Some(hm) = h.as_mapping() {
                for (k, v) in hm {
                    if let (Some(key), Some(val)) = (k.as_str(), v.as_str())
                    {
                        headers.insert(key.to_string(), val.to_string());
                    }
                }
            }
        }

        // Body — runn uses `body: { "application/json": { ... } }`
        if let Some(b) =
            detail_map.get(serde_yaml::Value::String("body".to_string()))
        {
            body = extract_body(b);
        }
    } else if details.is_null() {
        // e.g. `get: null` or `get:` (no body)
        debug!("No details for {} {}", method_str, path);
    }

    Ok(HttpRequest {
        method,
        url,
        headers,
        query: HashMap::new(),
        body,
    })
}

/// Extract the request body from runn's format.
/// Runn wraps body in content-type key:
/// `body: { "application/json": { ... } }`
/// or just `body: { ... }` directly.
fn extract_body(body_value: &serde_yaml::Value) -> Option<Value> {
    if let Some(mapping) = body_value.as_mapping() {
        // Check if it's wrapped in content-type key
        for (k, v) in mapping {
            if let Some(key_str) = k.as_str() {
                if key_str.contains('/') {
                    // Content-type wrapper, extract inner value
                    return yaml_to_json(v);
                }
            }
        }
        // Not wrapped — use directly
        yaml_to_json(body_value)
    } else {
        yaml_to_json(body_value)
    }
}

/// Convert a serde_yaml::Value to serde_json::Value.
fn yaml_to_json(yaml: &serde_yaml::Value) -> Option<Value> {
    let json_str = serde_json::to_string(
        &serde_yaml::from_value::<Value>(yaml.clone()).ok()?,
    )
    .ok()?;
    serde_json::from_str(&json_str).ok()
}

/// Try to infer expected status code from a test expression.
/// E.g. `"current.res.status == 201"` → Some(201)
fn infer_status_from_test(test: Option<&str>) -> Option<u16> {
    use regex::Regex;
    use std::sync::LazyLock;

    static STATUS_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"current\.res\.status\s*==\s*(\d+)")
            .expect("failed to compile status regex")
    });

    let expr = test?;
    let caps = STATUS_RE.captures(expr)?;
    caps[1].parse::<u16>().ok()
}

/// Check if a file path looks like a runn runbook.
pub fn is_runbook_file(path: &std::path::Path) -> bool {
    let name = match path.file_name().and_then(|n| n.to_str()) {
        Some(n) => n,
        None => return false,
    };
    // Common runn file patterns
    name.ends_with(".runbook.yml")
        || name.ends_with(".runbook.yaml")
        || name.ends_with(".runn.yml")
        || name.ends_with(".runn.yaml")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_runbook() {
        let yaml = r#"
desc: User API Test
runners:
  req: http://localhost:3000
vars:
  email: test@example.com
steps:
  create_user:
    req:
      /api/users:
        post:
          headers:
            Content-Type: application/json
          body:
            application/json:
              email: "{{ vars.email }}"
    test: |
      current.res.status == 201
    bind:
      user_id: current.res.body.id
  get_user:
    req:
      /api/users/{{ user_id }}:
        get:
    test: |
      current.res.status == 200
"#;

        let scenario = parse_runbook(yaml).unwrap();

        assert_eq!(scenario.name, "User API Test");
        assert_eq!(scenario.steps.len(), 2);
        assert_eq!(
            scenario.config.base_url,
            Some("http://localhost:3000".to_string())
        );

        // First step
        let step1 = &scenario.steps[0];
        assert_eq!(step1.name, "create_user");
        assert_eq!(step1.id, Some("create_user".to_string()));
        assert_eq!(step1.request.url, "http://localhost:3000/api/users");
        assert!(matches!(step1.request.method, HttpMethod::Post));
        assert!(step1.request.body.is_some());
        assert!(step1.test.is_some());
        assert_eq!(step1.expect.status, 201); // inferred
        assert!(step1.bind.contains_key("user_id"));

        // Second step
        let step2 = &scenario.steps[1];
        assert_eq!(step2.name, "get_user");
        assert!(matches!(step2.request.method, HttpMethod::Get));
    }

    #[test]
    fn test_parse_list_steps() {
        let yaml = r#"
desc: List Steps Test
runners:
  req: http://localhost:3000
steps:
  - req:
      /api/health:
        get:
    test: "current.res.status == 200"
  - req:
      /api/users:
        get:
    test: "current.res.status == 200"
"#;

        let scenario = parse_runbook(yaml).unwrap();
        assert_eq!(scenario.steps.len(), 2);
        assert_eq!(scenario.steps[0].name, "step_1");
        assert_eq!(scenario.steps[1].name, "step_2");
    }

    #[test]
    fn test_parse_with_loop() {
        let yaml = r#"
desc: Loop Test
runners:
  req: http://localhost:3000
steps:
  wait_ready:
    req:
      /api/status:
        get:
    loop:
      count: 10
      until: "current.res.body.status == 'ready'"
      interval: 2
      multiplier: 1.5
      maxInterval: 10
"#;

        let scenario = parse_runbook(yaml).unwrap();
        let step = &scenario.steps[0];
        assert!(step.loop_config.is_some());
        let lc = step.loop_config.as_ref().unwrap();
        assert_eq!(lc.count, 10);
        assert!(lc.until.is_some());
        assert_eq!(lc.interval, 2.0);
        assert_eq!(lc.multiplier, Some(1.5));
        assert_eq!(lc.max_interval, Some(10.0));
    }

    #[test]
    fn test_parse_labels_to_tags() {
        let yaml = r#"
desc: Labeled Runbook
labels:
  - auth
  - api
runners:
  req: http://localhost:3000
steps:
  health:
    req:
      /health:
        get:
"#;

        let scenario = parse_runbook(yaml).unwrap();
        assert_eq!(scenario.tags, vec!["auth", "api"]);
    }

    #[test]
    fn test_infer_status_from_test_expression() {
        assert_eq!(
            infer_status_from_test(Some("current.res.status == 201")),
            Some(201)
        );
        assert_eq!(
            infer_status_from_test(Some(
                "current.res.status == 200 && \
                 current.res.body.ok == true"
            )),
            Some(200)
        );
        assert_eq!(
            infer_status_from_test(Some(
                "current.res.body.name == \"alice\""
            )),
            None
        );
        assert_eq!(infer_status_from_test(None), None);
    }

    #[test]
    fn test_is_runbook_file() {
        use std::path::Path;
        assert!(is_runbook_file(Path::new("test.runbook.yml")));
        assert!(is_runbook_file(Path::new("test.runbook.yaml")));
        assert!(is_runbook_file(Path::new("test.runn.yml")));
        assert!(is_runbook_file(Path::new("test.runn.yaml")));
        assert!(!is_runbook_file(Path::new("test.yaml")));
        assert!(!is_runbook_file(Path::new("test.scenario.md")));
    }

    #[test]
    fn test_get_only_request() {
        let yaml = r#"
desc: GET only
runners:
  req: http://localhost:8080
steps:
  health:
    req:
      /health:
        get:
"#;
        let scenario = parse_runbook(yaml).unwrap();
        let step = &scenario.steps[0];
        assert!(matches!(step.request.method, HttpMethod::Get));
        assert_eq!(step.request.url, "http://localhost:8080/health");
        assert!(step.request.body.is_none());
    }

    #[test]
    fn test_force_maps_to_continue_on_failure() {
        let yaml = r#"
desc: Force test
force: true
runners:
  req: http://localhost:3000
steps:
  s1:
    req:
      /api:
        get:
"#;
        let scenario = parse_runbook(yaml).unwrap();
        assert!(scenario.config.continue_on_failure);
    }
}
