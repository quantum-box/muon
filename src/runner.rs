//! Test execution logic

use crate::expression;
use crate::model::*;
use crate::sse;
use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use regex::Regex;
use reqwest::{Client, Method as ReqMethod, Response};
use serde_json::{Map, Number, Value};
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tracing::{debug, error, info, instrument, warn};

/// Test runner trait
#[async_trait]
pub trait TestRunner: Send + Sync {
    /// Execute a test scenario
    async fn run(&self, scenario: &TestScenario) -> Result<TestResult>;
}

/// Default test runner
#[derive(Debug)]
pub struct DefaultTestRunner {
    client: Client,
}

impl DefaultTestRunner {
    /// Create a new test runner
    pub fn new() -> Self {
        Self {
            client: Client::new(),
        }
    }

    /// Create a new test runner with a custom client
    pub fn with_client(client: Client) -> Self {
        Self { client }
    }

    fn slugify(name: &str) -> String {
        let mut slug = String::new();
        for ch in name.chars() {
            if ch.is_ascii_alphanumeric() {
                slug.push(ch.to_ascii_lowercase());
            } else if (ch.is_whitespace() || matches!(ch, '-' | '_'))
                && !slug.ends_with('_')
            {
                slug.push('_');
            }
        }
        slug.trim_matches('_').to_string()
    }

    fn map_string_to_value(map: &HashMap<String, String>) -> Value {
        let mut obj = Map::new();
        for (k, v) in map {
            obj.insert(k.clone(), Value::String(v.clone()));
        }
        Value::Object(obj)
    }

    /// Build a runn-compatible `current` value containing `res`
    /// and `req` sub-objects.
    fn build_current_value(
        status: u16,
        headers: &HashMap<String, String>,
        parsed_json: &Option<Value>,
        raw_body: &str,
        req_info: &RequestInfo,
    ) -> Value {
        // Build res object (runn-compatible)
        let mut res = Map::new();
        res.insert(
            "status".into(),
            Value::Number(Number::from(status)),
        );
        if !headers.is_empty() {
            res.insert(
                "headers".into(),
                Self::map_string_to_value(headers),
            );
        }
        // res.body is parsed JSON (runn convention), not raw
        // string
        if let Some(json) = parsed_json {
            res.insert("body".into(), json.clone());
        } else {
            res.insert("body".into(), Value::String(raw_body.into()));
        }
        res.insert("rawBody".into(), Value::String(raw_body.into()));

        // Build req object
        let mut req = Map::new();
        req.insert(
            "method".into(),
            Value::String(req_info.method.clone()),
        );
        req.insert("url".into(), Value::String(req_info.url.clone()));
        if !req_info.headers.is_empty() {
            req.insert(
                "headers".into(),
                Self::map_string_to_value(&req_info.headers),
            );
        }
        if let Some(body) = &req_info.body {
            if let Ok(parsed) = serde_json::from_str::<Value>(body) {
                req.insert("body".into(), parsed);
            } else {
                req.insert("body".into(), Value::String(body.clone()));
            }
        }

        let mut current = Map::new();
        current.insert("res".into(), Value::Object(res));
        current.insert("req".into(), Value::Object(req));
        Value::Object(current)
    }

    /// Execute a single step with optional loop/retry.
    async fn execute_step_with_loop(
        &self,
        step: &TestStep,
        vars: &mut HashMap<String, Value>,
        config: &TestConfig,
        steps_map: &mut Map<String, Value>,
        step_idx: usize,
        step_key_counts: &mut HashMap<String, usize>,
        previous_value: &mut Option<Value>,
    ) -> Result<Option<StepResult>> {
        if let Some(ref loop_cfg) = step.loop_config {
            let max = loop_cfg.count;
            let mut interval = loop_cfg.interval;

            for i in 0..max {
                debug!("Loop iteration {}/{} for step '{}'", i + 1, max, step.name);

                let result = self
                    .execute_step_once(
                        step,
                        vars,
                        config,
                        steps_map,
                        step_idx,
                        step_key_counts,
                        previous_value,
                    )
                    .await?;

                // Check until condition
                if let Some(ref until_expr) = loop_cfg.until {
                    match expression::evaluate_test(until_expr, vars)
                    {
                        Ok(true) => {
                            debug!(
                                "Loop until condition met: {}",
                                until_expr
                            );
                            return Ok(result);
                        }
                        Ok(false) => {}
                        Err(e) => {
                            warn!(
                                "Loop until expression error: {}",
                                e
                            );
                        }
                    }
                }

                // If no until condition, stop on success
                if loop_cfg.until.is_none() {
                    if let Some(ref r) = result {
                        if r.success {
                            return Ok(result);
                        }
                    }
                }

                // Wait before next iteration (unless last)
                if i + 1 < max {
                    tokio::time::sleep(Duration::from_secs_f64(
                        interval,
                    ))
                    .await;
                    // Apply multiplier
                    if let Some(mult) = loop_cfg.multiplier {
                        interval *= mult;
                        if let Some(max_i) = loop_cfg.max_interval {
                            interval = interval.min(max_i);
                        }
                    }
                }
            }

            // All iterations exhausted — return last result
            // Re-execute one final time to get the result
            self.execute_step_once(
                step,
                vars,
                config,
                steps_map,
                step_idx,
                step_key_counts,
                previous_value,
            )
            .await
        } else {
            self.execute_step_once(
                step,
                vars,
                config,
                steps_map,
                step_idx,
                step_key_counts,
                previous_value,
            )
            .await
        }
    }

    fn get_value_by_path<'a>(
        value: &'a Value,
        path: &str,
    ) -> Option<&'a Value> {
        let mut current = value;

        if path.is_empty() {
            return Some(current);
        }

        for part in path.split('.') {
            if part.is_empty() {
                continue;
            }

            match current {
                Value::Object(map) => {
                    current = map.get(part)?;
                }
                Value::Array(array) => {
                    let index = part.parse::<usize>().ok()?;
                    current = array.get(index)?;
                }
                _ => {
                    return None;
                }
            }
        }

        Some(current)
    }

    fn flatten_value(
        prefix: &str,
        value: &Value,
        vars: &mut HashMap<String, Value>,
    ) {
        match value {
            Value::Object(map) => {
                if map.is_empty() {
                    vars.insert(prefix.to_string(), value.clone());
                }
                for (key, val) in map {
                    let new_prefix = if prefix.is_empty() {
                        key.clone()
                    } else {
                        format!("{prefix}.{key}")
                    };
                    Self::flatten_value(&new_prefix, val, vars);
                }
            }
            Value::Array(array) => {
                if array.is_empty() {
                    vars.insert(prefix.to_string(), value.clone());
                }
                for (idx, val) in array.iter().enumerate() {
                    let new_prefix = format!("{prefix}.{idx}");
                    Self::flatten_value(&new_prefix, val, vars);
                }
            }
            _ => {
                vars.insert(prefix.to_string(), value.clone());
            }
        }
    }

    /// Expand `{{ key }}` or `{{ vars.key }}` placeholders in
    /// `text` by looking up each captured key in `vars`.
    ///
    /// Uses a single pre-compiled regex instead of compiling one
    /// regex per variable, reducing O(V) regex compilations to O(1).
    fn expand_variables(
        &self,
        text: &str,
        vars: &HashMap<String, Value>,
    ) -> String {
        use std::sync::LazyLock;

        // Single regex that matches {{ key }} or {{ vars.key }}
        // and captures the key name (group 1).
        static PLACEHOLDER_RE: LazyLock<Regex> = LazyLock::new(|| {
            Regex::new(r"\{\{\s*(?:vars\.)?(.+?)\s*\}\}")
                .expect("failed to compile placeholder regex")
        });

        PLACEHOLDER_RE
            .replace_all(text, |caps: &regex::Captures| {
                let key = &caps[1];
                match vars.get(key) {
                    Some(Value::String(s)) => s.clone(),
                    Some(v) => v.to_string(),
                    None => caps[0].to_string(),
                }
            })
            .into_owned()
    }

    /// TODO: add English documentation
    fn convert_method(&self, method: &HttpMethod) -> ReqMethod {
        match method {
            HttpMethod::Get => ReqMethod::GET,
            HttpMethod::Post => ReqMethod::POST,
            HttpMethod::Put => ReqMethod::PUT,
            HttpMethod::Delete => ReqMethod::DELETE,
            HttpMethod::Patch => ReqMethod::PATCH,
            HttpMethod::Head => ReqMethod::HEAD,
            HttpMethod::Options => ReqMethod::OPTIONS,
        }
    }

    /// TODO: add English documentation
    #[instrument(skip(self, request, vars, config), fields(url = %request.url, method = ?request.method))]
    async fn send_request(
        &self,
        request: &HttpRequest,
        vars: &HashMap<String, Value>,
        config: &TestConfig,
    ) -> Result<(Response, RequestInfo)> {
        // TODO: add English comment
        let mut url = self.expand_variables(&request.url, vars);

        if !url.contains("://") {
            if let Some(base_url) = &config.base_url {
                let base = reqwest::Url::parse(base_url).context(format!(
                    "Invalid base_url provided in scenario config: {base_url}"
                ))?;
                let joined = if url.is_empty() {
                    base
                } else {
                    let normalized = if url.starts_with('/') {
                        url.trim_start_matches('/').to_string()
                    } else {
                        url.clone()
                    };
                    base.join(&normalized).context(format!(
                        "Failed to join base_url '{base_url}' with path '{url}'"
                    ))?
                };
                url = joined.to_string();
            }
        }

        // TODO: add English comment
        let mut headers = request.headers.clone();
        for (key, value) in &config.headers {
            if !headers.contains_key(key) {
                headers.insert(key.clone(), value.clone());
            }
        }

        let headers: HashMap<String, String> = headers
            .into_iter()
            .map(|(k, v)| (k, self.expand_variables(&v, vars)))
            .collect();

        // TODO: add English comment
        let mut req_builder = self
            .client
            .request(self.convert_method(&request.method), &url)
            .timeout(Duration::from_secs(config.timeout));

        // TODO: add English comment
        for (name, value) in &headers {
            req_builder = req_builder.header(name, value);
        }

        // TODO: add English comment
        if !request.query.is_empty() {
            let query: HashMap<String, String> = request
                .query
                .iter()
                .map(|(k, v)| (k.clone(), self.expand_variables(v, vars)))
                .collect();

            req_builder = req_builder.query(&query);
        }

        // TODO: add English comment
        let mut body_str = None;
        if let Some(body) = &request.body {
            // TODO: add English comment
            let body_json = serde_json::to_string(body)?;
            let expanded_body = self.expand_variables(&body_json, vars);
            body_str = Some(expanded_body.clone());
            req_builder = req_builder
                .header("Content-Type", "application/json")
                .body(expanded_body);
        }

        // TODO: add English comment
        let req_info = RequestInfo {
            method: format!("{:?}", request.method),
            url: url.clone(),
            headers: headers.clone(),
            body: body_str,
        };

        // TODO: add English comment
        debug!("Sending request to {}", url);
        let response =
            req_builder.send().await.context("Failed to send request")?;
        debug!("Received response with status: {}", response.status());

        Ok((response, req_info))
    }

    /// TODO: add English documentation
    async fn save_variables(
        &self,
        save: &HashMap<String, String>,
        body: &str,
        vars: &mut HashMap<String, Value>,
    ) -> Result<()> {
        if save.is_empty() {
            return Ok(());
        }

        // TODO: add English comment
        let json_body: Value = serde_json::from_str(body)
            .context("Failed to parse response as JSON")?;

        for (var_name, json_path) in save {
            // TODO: add English comment
            let parts: Vec<&str> = json_path.split('.').collect();
            let mut current = &json_body;

            for part in parts {
                // Try string key first (objects), then numeric
                // index (arrays).
                let resolved = current.get(part).or_else(|| {
                    part.parse::<usize>()
                        .ok()
                        .and_then(|idx| current.get(idx))
                });
                if let Some(value) = resolved {
                    current = value;
                } else {
                    return Err(anyhow!(
                        "JSON path '{json_path}' not found in response"
                    ));
                }
            }

            vars.insert(var_name.clone(), current.clone());
            debug!(
                "Saved variable '{}' with value: {:?}",
                var_name, current
            );
        }

        Ok(())
    }
}

impl Default for DefaultTestRunner {
    fn default() -> Self {
        Self::new()
    }
}

impl DefaultTestRunner {
    /// Execute a single step (no loop/retry).
    #[allow(clippy::too_many_arguments)]
    async fn execute_step_once(
        &self,
        step: &TestStep,
        vars: &mut HashMap<String, Value>,
        config: &TestConfig,
        steps_map: &mut Map<String, Value>,
        step_idx: usize,
        step_key_counts: &mut HashMap<String, usize>,
        previous_value: &mut Option<Value>,
    ) -> Result<Option<StepResult>> {
        let step_start = Instant::now();
        let mut step_success = true;
        let mut step_error = None;

        // Handle include: — delegate to included scenario
        if let Some(ref include) = step.include {
            let include_path =
                self.expand_variables(&include.path, vars);
            debug!(
                "Including external scenario: {}",
                include_path
            );

            let config_mgr = crate::config::TestConfigManager::new();
            let mut included =
                config_mgr.load_scenario(&include_path).map_err(
                    |e| {
                        anyhow!(
                            "Failed to load included scenario \
                             '{}': {}",
                            include_path,
                            e
                        )
                    },
                )?;

            // Override included scenario vars with provided
            // ones
            for (k, v) in &include.vars {
                let json_str = serde_json::to_string(v)?;
                let expanded =
                    self.expand_variables(&json_str, vars);
                if let Ok(val) =
                    serde_json::from_str::<Value>(&expanded)
                {
                    included.vars.insert(k.clone(), val);
                }
            }

            // Copy parent vars to included scenario
            for (k, v) in vars.iter() {
                included
                    .vars
                    .entry(k.clone())
                    .or_insert_with(|| v.clone());
            }

            // Inherit config if not set
            if included.config.base_url.is_none() {
                included.config.base_url =
                    config.base_url.clone();
            }
            for (k, v) in &config.headers {
                included
                    .config
                    .headers
                    .entry(k.clone())
                    .or_insert_with(|| v.clone());
            }

            let result = self.run(&included).await?;

            // Merge results back
            let step_key = step
                .id
                .clone()
                .unwrap_or_else(|| Self::slugify(&step.name));

            // Store included scenario's steps under
            // parent.steps.<key>.steps
            let mut included_steps_map = Map::new();
            for sr in &result.steps {
                let mut sr_map = Map::new();
                sr_map.insert(
                    "name".into(),
                    Value::String(sr.name.clone()),
                );
                sr_map.insert(
                    "success".into(),
                    Value::Bool(sr.success),
                );
                included_steps_map.insert(
                    sr.name.clone(),
                    Value::Object(sr_map),
                );
            }

            let mut step_value_map = Map::new();
            step_value_map.insert(
                "steps".into(),
                Value::Object(included_steps_map),
            );
            steps_map.insert(
                step_key,
                Value::Object(step_value_map),
            );

            return Ok(Some(StepResult {
                name: step.name.clone(),
                success: result.success,
                error: result.error,
                request: RequestInfo {
                    method: "INCLUDE".to_string(),
                    url: include_path,
                    headers: HashMap::new(),
                    body: None,
                },
                response: None,
                duration_ms: step_start.elapsed().as_millis()
                    as u64,
            }));
        }

        // Condition check
        if let Some(condition) = &step.condition {
            let expanded_condition =
                self.expand_variables(condition, vars);
            if expanded_condition.trim().to_lowercase() != "true" {
                debug!(
                    "Skipping step due to condition: {}",
                    condition
                );
                return Ok(None);
            }
        }

        // Send request
        let send_result =
            self.send_request(&step.request, vars, config).await;

        let (response, req_info) = match send_result {
            Ok(res) => res,
            Err(err) => {
                error!("Failed to send request: {}", err);
                return Ok(Some(StepResult {
                    name: step.name.clone(),
                    success: false,
                    error: Some(format!(
                        "リクエスト送信エラー: {err}"
                    )),
                    request: RequestInfo {
                        method: format!("{:?}", step.request.method),
                        url: self.expand_variables(
                            &step.request.url,
                            vars,
                        ),
                        headers: HashMap::new(),
                        body: None,
                    },
                    response: None,
                    duration_ms: step_start.elapsed().as_millis()
                        as u64,
                }));
            }
        };

        let status = response.status().as_u16();
        let headers: HashMap<String, String> = response
            .headers()
            .iter()
            .map(|(name, value)| {
                (
                    name.to_string(),
                    value.to_str().unwrap_or("").to_string(),
                )
            })
            .collect();

        let body = response
            .text()
            .await
            .context("Failed to read response body")?;

        let response_info = Some(ResponseInfo {
            status,
            headers: headers.clone(),
            body: Some(body.clone()),
        });

        let parsed_json =
            serde_json::from_str::<Value>(&body).ok();

        // Detect SSE
        let is_sse = step.expect.sse.is_some()
            || headers
                .get("content-type")
                .map(|ct| ct.contains("text/event-stream"))
                .unwrap_or(false);

        let sse_events = if is_sse {
            Some(sse::parse_sse_events(&body))
        } else {
            None
        };

        let outputs_value =
            if let Some(ref events) = sse_events {
                sse::build_sse_value(events)
            } else {
                parsed_json
                    .as_ref()
                    .and_then(|json| match json {
                        Value::Object(obj) => obj
                            .get("data")
                            .cloned()
                            .or_else(|| Some(json.clone())),
                        _ => Some(json.clone()),
                    })
                    .unwrap_or(Value::Null)
            };

        let request_value = {
            let mut req_map = Map::new();
            req_map.insert(
                "method".into(),
                Value::String(req_info.method.clone()),
            );
            req_map.insert(
                "url".into(),
                Value::String(req_info.url.clone()),
            );
            if !req_info.headers.is_empty() {
                req_map.insert(
                    "headers".into(),
                    Self::map_string_to_value(&req_info.headers),
                );
            }
            if let Some(body) = &req_info.body {
                req_map.insert(
                    "body".into(),
                    Value::String(body.clone()),
                );
            }
            Value::Object(req_map)
        };

        let mut response_map = Map::new();
        response_map.insert(
            "status".into(),
            Value::Number(Number::from(status)),
        );
        if !headers.is_empty() {
            response_map.insert(
                "headers".into(),
                Self::map_string_to_value(&headers),
            );
        }
        response_map
            .insert("body".into(), Value::String(body.clone()));
        if let Some(json) = &parsed_json {
            response_map.insert("json".into(), json.clone());
        }
        let response_value = Value::Object(response_map);

        // Build step key
        let mut step_key = step
            .id
            .clone()
            .unwrap_or_else(|| Self::slugify(&step.name));
        if step_key.is_empty() {
            step_key = format!("step{}", step_idx + 1);
        }
        let count_entry =
            step_key_counts.entry(step_key.clone()).or_insert(0);
        if *count_entry > 0 {
            step_key =
                format!("{}_{}", step_key, *count_entry + 1);
        }
        *count_entry += 1;

        // ── Set runn-compatible `current` variable ──────
        let current_value = Self::build_current_value(
            status,
            &headers,
            &parsed_json,
            &body,
            &req_info,
        );
        vars.insert("current".to_string(), current_value.clone());

        // Set `previous` from prior step
        if let Some(ref prev) = previous_value {
            vars.insert("previous".to_string(), prev.clone());
        }

        // ── Declarative `expect:` validation ────────────

        // Status code
        if status != step.expect.status {
            step_success = false;
            step_error = Some(format!(
                "ステータスコードが期待値と一致しません。\
                 期待: {}, 実際: {}",
                step.expect.status, status
            ));
        }

        // Headers
        for (name, expected) in &step.expect.headers {
            if let Some(actual) = headers.get(name) {
                if actual != expected {
                    step_success = false;
                    step_error = Some(format!(
                        "ヘッダー '{name}' の値が期待値と一致しません。\
                         期待: {expected}, 実際: {actual}"
                    ));
                }
            } else {
                step_success = false;
                step_error = Some(format!(
                    "ヘッダー '{name}' がレスポンスに存在しません"
                ));
            }
        }

        // JSON path validation
        if !step.expect.json.is_empty()
            || !step.expect.json_lengths.is_empty()
        {
            if let Some(json_body) = &parsed_json {
                for (path, expected) in &step.expect.json {
                    match Self::get_value_by_path(json_body, path)
                    {
                        Some(actual) => {
                            if actual != expected {
                                step_success = false;
                                step_error = Some(format!(
                                    "JSONパス '{path}' の値が\
                                     期待値と一致しません。\
                                     期待: {expected:?}, \
                                     実際: {actual:?}"
                                ));
                            }
                        }
                        None => {
                            step_success = false;
                            step_error = Some(format!(
                                "JSONパス '{path}' が\
                                 レスポンスに存在しません"
                            ));
                        }
                    }
                }

                for (path, expected_len) in
                    &step.expect.json_lengths
                {
                    match Self::get_value_by_path(json_body, path)
                    {
                        Some(Value::Array(array)) => {
                            if array.len() != *expected_len {
                                step_success = false;
                                step_error = Some(format!(
                                    "JSONパス '{path}' の配列長が\
                                     一致しません。\
                                     期待: {expected_len}, \
                                     実際: {}",
                                    array.len()
                                ));
                            }
                        }
                        Some(Value::Object(obj)) => {
                            if obj.len() != *expected_len {
                                step_success = false;
                                step_error = Some(format!(
                                    "JSONパス '{path}' の\
                                     オブジェクト要素数が\
                                     一致しません。\
                                     期待: {expected_len}, \
                                     実際: {}",
                                    obj.len()
                                ));
                            }
                        }
                        Some(other) => {
                            step_success = false;
                            step_error = Some(format!(
                                "JSONパス '{path}' は配列\
                                 またはオブジェクトではありません \
                                 (実際: {other:?})"
                            ));
                        }
                        None => {
                            step_success = false;
                            step_error = Some(format!(
                                "JSONパス '{path}' が\
                                 レスポンスに存在しません"
                            ));
                        }
                    }
                }
            } else {
                step_success = false;
                step_error = Some(
                    "レスポンスが有効なJSONではありません"
                        .to_string(),
                );
            }
        }

        // json_eq — full equality check
        if let Some(ref exact_expected) = step.expect.json_eq {
            if let Some(json_body) = &parsed_json {
                let expanded_json =
                    serde_json::to_string(exact_expected)?;
                let expanded_str =
                    self.expand_variables(&expanded_json, vars);
                let expanded: Value =
                    serde_json::from_str(&expanded_str)?;
                let exact_errors =
                    crate::validator::validate_data_eq(
                        json_body,
                        &expanded,
                        &step.expect.json_ignore_fields,
                        "",
                    );
                if !exact_errors.is_empty() {
                    step_success = false;
                    step_error = Some(exact_errors.join("; "));
                }
            } else {
                step_success = false;
                step_error = Some(
                    "json_eq: response is not valid JSON"
                        .to_string(),
                );
            }
        }

        // Contains
        for text in &step.expect.contains {
            let expanded_text =
                self.expand_variables(text, vars);
            if !body.contains(&expanded_text) {
                error!(
                    "レスポンスボディに期待するテキスト \
                     '{expanded_text}' が含まれていません \
                     (ステップ: {})",
                    step.name
                );
                step_success = false;
                step_error = Some(format!(
                    "レスポンスボディに期待するテキスト \
                     '{expanded_text}' が含まれていません"
                ));
            }
        }

        // SSE validation
        if let (Some(sse_expect), Some(ref events)) =
            (&step.expect.sse, &sse_events)
        {
            let vars_clone = vars.clone();
            let expand_fn = |s: &str| -> String {
                self.expand_variables(s, &vars_clone)
            };
            let (sse_errors, sse_saved) =
                sse::validate_sse(events, sse_expect, &expand_fn);
            for err in &sse_errors {
                error!(
                    "SSE validation error (step: {}): {}",
                    step.name, err
                );
            }
            if !sse_errors.is_empty() {
                step_success = false;
                step_error = Some(sse_errors.join("; "));
            }
            for (k, v) in sse_saved {
                vars.insert(k, v);
            }
        }

        // ── CEL `test:` expression assertion ────────────
        if step_success {
            if let Some(ref test_expr) = step.test {
                let expanded =
                    self.expand_variables(test_expr, vars);
                match expression::evaluate_test(&expanded, vars) {
                    Ok(true) => {
                        debug!(
                            "test: expression passed: {}",
                            test_expr
                        );
                    }
                    Ok(false) => {
                        step_success = false;
                        step_error = Some(format!(
                            "test expression failed: {test_expr}"
                        ));
                    }
                    Err(e) => {
                        step_success = false;
                        step_error = Some(format!(
                            "test expression error: {e}"
                        ));
                    }
                }
            }
        }

        // ── Save variables (muon native) ────────────────
        if step_success && !step.save.is_empty() {
            if sse_events.is_some() {
                let sse_value = &outputs_value;
                for (var_name, path) in &step.save {
                    let actual_path =
                        if let Some(stripped) =
                            path.strip_prefix("sse.")
                        {
                            stripped
                        } else {
                            path.as_str()
                        };
                    if let Some(val) = Self::get_value_by_path(
                        sse_value,
                        actual_path,
                    ) {
                        vars.insert(
                            var_name.clone(),
                            val.clone(),
                        );
                        debug!(
                            "Saved SSE variable '{}' = {:?}",
                            var_name, val
                        );
                    } else {
                        warn!(
                            "SSE save path '{}' not found",
                            path
                        );
                    }
                }
            } else if let Err(err) = self
                .save_variables(&step.save, &body, vars)
                .await
            {
                warn!("Failed to save variables: {}", err);
            }
        }

        // ── Bind variables (runn-compatible, CEL) ───────
        if step_success && !step.bind.is_empty() {
            for (var_name, expr) in &step.bind {
                let expanded = self.expand_variables(expr, vars);
                match expression::resolve_value(
                    &expanded, vars,
                ) {
                    Ok(val) => {
                        debug!(
                            "Bound variable '{}' = {:?}",
                            var_name, val
                        );
                        vars.insert(var_name.clone(), val);
                    }
                    Err(e) => {
                        warn!(
                            "bind '{}' failed: {}",
                            var_name, e
                        );
                    }
                }
            }
        }

        let duration_ms = step_start.elapsed().as_millis() as u64;

        // ── Store step in steps map ─────────────────────
        let mut step_value_map = Map::new();
        step_value_map.insert(
            "id".into(),
            Value::String(step_key.clone()),
        );
        step_value_map.insert(
            "name".into(),
            Value::String(step.name.clone()),
        );
        step_value_map
            .insert("success".into(), Value::Bool(step_success));
        step_value_map.insert(
            "durationMs".into(),
            Value::Number(Number::from(duration_ms)),
        );
        step_value_map
            .insert("request".into(), request_value.clone());
        step_value_map
            .insert("response".into(), response_value.clone());
        step_value_map
            .insert("outputs".into(), outputs_value.clone());
        // Add runn-compatible `res` key
        if let Some(current_res) =
            current_value.get("res").cloned()
        {
            step_value_map.insert("res".into(), current_res);
        }

        let step_value = Value::Object(step_value_map);
        steps_map
            .insert(step_key.clone(), step_value.clone());
        Self::flatten_value(
            &format!("steps.{step_key}"),
            &step_value,
            vars,
        );
        vars.insert(
            "steps".to_string(),
            Value::Object(steps_map.clone()),
        );

        // Update `previous` for next step
        *previous_value = Some(current_value);

        // Add env variables
        for (key, value) in std::env::vars() {
            vars.entry(format!("env.{key}"))
                .or_insert_with(|| Value::String(value));
        }

        Ok(Some(StepResult {
            name: step.name.clone(),
            success: step_success,
            error: step_error.clone(),
            request: req_info,
            response: response_info,
            duration_ms,
        }))
    }
}

#[async_trait]
impl TestRunner for DefaultTestRunner {
    #[instrument(skip(self, scenario), fields(name = %scenario.name))]
    async fn run(
        &self,
        scenario: &TestScenario,
    ) -> Result<TestResult> {
        let start_time = Instant::now();
        let mut scenario_success = true;
        let mut step_results = Vec::new();
        let mut vars = scenario.vars.clone();
        let mut steps_map: Map<String, Value> = Map::new();
        let mut step_key_counts: HashMap<String, usize> =
            HashMap::new();
        let mut previous_value: Option<Value> = None;

        info!("Starting test scenario: {}", scenario.name);

        for (step_idx, step) in
            scenario.steps.iter().enumerate()
        {
            info!(
                "Running step {}/{}: {}",
                step_idx + 1,
                scenario.steps.len(),
                step.name
            );

            let result = self
                .execute_step_with_loop(
                    step,
                    &mut vars,
                    &scenario.config,
                    &mut steps_map,
                    step_idx,
                    &mut step_key_counts,
                    &mut previous_value,
                )
                .await?;

            if let Some(step_result) = result {
                let failed = !step_result.success;
                step_results.push(step_result);

                if failed {
                    scenario_success = false;
                    if !scenario.config.continue_on_failure {
                        info!(
                            "Stopping scenario due to step \
                             failure"
                        );
                        break;
                    }
                }
            }
        }

        let result = TestResult {
            name: scenario.name.clone(),
            success: scenario_success,
            error: if scenario_success {
                None
            } else {
                Some(
                    "一部のステップが失敗しました".to_string(),
                )
            },
            steps: step_results,
            duration_ms: start_time.elapsed().as_millis() as u64,
        };

        info!(
            "Test scenario finished: {} ({} ms) - Success: {}",
            scenario.name, result.duration_ms, result.success
        );

        Ok(result)
    }
}
