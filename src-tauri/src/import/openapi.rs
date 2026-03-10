//! Parse an OpenAPI 3.0 JSON specification into muon
//! scenarios.
//!
//! Generates one scenario per path+method combination with
//! example request bodies derived from the schema.

use anyhow::{Context, Result};
use muon::model::{
    HttpMethod, HttpRequest, ResponseExpectation, TestConfig,
    TestScenario, TestStep,
};
use serde_json::Value;
use std::collections::HashMap;

/// Parse an OpenAPI 3.0 JSON spec and generate test
/// scenarios.
pub fn parse_spec(
    json_str: &str,
    base_url: &str,
) -> Result<Vec<TestScenario>> {
    let spec: Value = serde_json::from_str(json_str)
        .context("failed to parse OpenAPI JSON")?;

    let paths = spec
        .get("paths")
        .and_then(|p| p.as_object())
        .context("missing 'paths' in OpenAPI spec")?;

    let mut scenarios = Vec::new();

    for (path, path_obj) in paths {
        let methods = match path_obj.as_object() {
            Some(m) => m,
            None => continue,
        };

        for (method_str, operation) in methods {
            let method = match parse_method(method_str) {
                Some(m) => m,
                None => continue, // skip parameters, etc.
            };

            let op_id = operation
                .get("operationId")
                .and_then(|v| v.as_str())
                .unwrap_or(path.as_str());

            let summary = operation
                .get("summary")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            // Extract path/query parameters
            let (query, headers) =
                extract_parameters(operation);

            // Extract request body example
            let body = extract_request_body(operation, &spec);

            // Determine expected status from responses
            let status = extract_success_status(operation);

            let step = TestStep {
                name: format!(
                    "{} {}",
                    method_str.to_uppercase(),
                    path
                ),
                id: Some(slugify(op_id)),
                description: summary.clone(),
                request: HttpRequest {
                    method,
                    url: format!("{base_url}{path}"),
                    headers,
                    query,
                    body,
                },
                expect: ResponseExpectation {
                    status,
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
            };

            let scenario = TestScenario {
                name: format!(
                    "{} {}",
                    method_str.to_uppercase(),
                    path
                ),
                description: summary,
                tags: vec!["openapi-import".to_string()],
                steps: vec![step],
                vars: HashMap::new(),
                config: TestConfig {
                    base_url: Some(base_url.to_string()),
                    headers: HashMap::new(),
                    timeout: 30,
                    continue_on_failure: false,
                },
            };

            scenarios.push(scenario);
        }
    }

    Ok(scenarios)
}

fn parse_method(s: &str) -> Option<HttpMethod> {
    match s.to_lowercase().as_str() {
        "get" => Some(HttpMethod::Get),
        "post" => Some(HttpMethod::Post),
        "put" => Some(HttpMethod::Put),
        "delete" => Some(HttpMethod::Delete),
        "patch" => Some(HttpMethod::Patch),
        "head" => Some(HttpMethod::Head),
        "options" => Some(HttpMethod::Options),
        _ => None,
    }
}

/// Extract query and header parameters from the operation.
fn extract_parameters(
    operation: &Value,
) -> (HashMap<String, String>, HashMap<String, String>) {
    let mut query = HashMap::new();
    let mut headers = HashMap::new();

    if let Some(params) =
        operation.get("parameters").and_then(|p| p.as_array())
    {
        for param in params {
            let name = param
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("")
                .to_string();
            let location = param
                .get("in")
                .and_then(|i| i.as_str())
                .unwrap_or("");

            let example = param
                .get("example")
                .or_else(|| {
                    param
                        .get("schema")
                        .and_then(|s| s.get("example"))
                })
                .map(|v| value_to_string(v))
                .unwrap_or_else(|| {
                    generate_example_for_type(
                        param.get("schema"),
                    )
                });

            match location {
                "query" => {
                    query.insert(name, example);
                }
                "header" => {
                    headers.insert(name, example);
                }
                _ => {} // path params are in the URL template
            }
        }
    }

    (query, headers)
}

/// Extract a request body example from the operation spec.
fn extract_request_body(
    operation: &Value,
    _root: &Value,
) -> Option<Value> {
    let body = operation.get("requestBody")?;
    let content = body.get("content")?;

    // Prefer application/json
    let media = content
        .get("application/json")
        .or_else(|| {
            content
                .as_object()
                .and_then(|m| m.values().next())
        })?;

    // Try explicit example first
    if let Some(example) = media.get("example") {
        return Some(example.clone());
    }

    // Generate from schema
    media
        .get("schema")
        .map(|schema| generate_example(schema))
}

/// Generate example values from a JSON Schema.
fn generate_example(schema: &Value) -> Value {
    if let Some(example) = schema.get("example") {
        return example.clone();
    }

    let schema_type = schema
        .get("type")
        .and_then(|t| t.as_str())
        .unwrap_or("string");

    match schema_type {
        "object" => {
            let mut obj = serde_json::Map::new();
            if let Some(props) = schema
                .get("properties")
                .and_then(|p| p.as_object())
            {
                for (key, prop_schema) in props {
                    obj.insert(
                        key.clone(),
                        generate_example(prop_schema),
                    );
                }
            }
            Value::Object(obj)
        }
        "array" => {
            let item_schema =
                schema.get("items").cloned().unwrap_or(
                    Value::Object(serde_json::Map::new()),
                );
            Value::Array(vec![generate_example(&item_schema)])
        }
        "integer" => Value::Number(1.into()),
        "number" => serde_json::Number::from_f64(1.0)
            .map(Value::Number)
            .unwrap_or(Value::Number(1.into())),
        "boolean" => Value::Bool(true),
        _ => Value::String("example".to_string()),
    }
}

fn generate_example_for_type(
    schema: Option<&Value>,
) -> String {
    match schema.and_then(|s| {
        s.get("type").and_then(|t| t.as_str())
    }) {
        Some("integer") => "1".to_string(),
        Some("number") => "1.0".to_string(),
        Some("boolean") => "true".to_string(),
        _ => "example".to_string(),
    }
}

/// Find the first success status code from responses.
fn extract_success_status(operation: &Value) -> u16 {
    if let Some(responses) = operation
        .get("responses")
        .and_then(|r| r.as_object())
    {
        for code in &["200", "201", "204", "202"] {
            if responses.contains_key(*code) {
                return code.parse().unwrap_or(200);
            }
        }
        // Fallback to first 2xx
        for (code, _) in responses {
            if code.starts_with('2') {
                return code.parse().unwrap_or(200);
            }
        }
    }
    200
}

fn value_to_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn slugify(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string()
}
