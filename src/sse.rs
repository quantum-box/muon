//! SSE (Server-Sent Events) parser, validator, and value builder
//! for scenario test assertions.

use crate::model::{SseEventExpectation, SseExpectation};
use regex::Regex;
use serde_json::{Map, Value};
use std::collections::HashMap;

/// A parsed SSE event with event type and data payload.
#[derive(Debug, Clone)]
pub struct SseEvent {
    /// The `event:` field (e.g. "tool_call", "done")
    pub event_type: String,
    /// The raw `data:` payload text
    pub data_raw: String,
    /// Parsed JSON from the data payload, if valid JSON
    pub data_json: Option<Value>,
}

/// Parse a raw SSE text body into a list of structured events.
///
/// SSE format:
/// ```text
/// event: tool_call
/// data: {"tool_id":"tc_123","tool_name":"execute_command"}
///
/// event: done
/// data: {}
/// ```
pub fn parse_sse_events(body: &str) -> Vec<SseEvent> {
    let mut events = Vec::new();
    let mut current_event_type: Option<String> = None;
    let mut current_data_parts: Vec<String> = Vec::new();

    for line in body.lines() {
        if let Some(stripped) = line.strip_prefix("event:") {
            // Flush any previous event
            if let Some(event_type) = current_event_type.take() {
                let data_raw = current_data_parts.join("\n");
                let data_json =
                    serde_json::from_str::<Value>(&data_raw).ok();
                events.push(SseEvent {
                    event_type,
                    data_raw,
                    data_json,
                });
                current_data_parts.clear();
            }
            current_event_type = Some(stripped.trim().to_string());
        } else if let Some(stripped) = line.strip_prefix("data:") {
            let data = stripped.trim().to_string();
            current_data_parts.push(data);
        } else if line.is_empty() {
            // Blank line = event boundary
            if let Some(event_type) = current_event_type.take() {
                let data_raw = current_data_parts.join("\n");
                let data_json =
                    serde_json::from_str::<Value>(&data_raw).ok();
                events.push(SseEvent {
                    event_type,
                    data_raw,
                    data_json,
                });
                current_data_parts.clear();
            }
        }
    }

    // Flush final event if no trailing blank line
    if let Some(event_type) = current_event_type.take() {
        let data_raw = current_data_parts.join("\n");
        let data_json = serde_json::from_str::<Value>(&data_raw).ok();
        events.push(SseEvent {
            event_type,
            data_raw,
            data_json,
        });
    }

    events
}

/// Build a grouped JSON value from SSE events for variable extraction.
///
/// Returns a JSON object like:
/// ```json
/// {
///   "tool_call": [ {data_json}, ... ],
///   "usage": [ {data_json}, ... ],
///   "done": [ {} ],
///   ...
/// }
/// ```
pub fn build_sse_value(events: &[SseEvent]) -> Value {
    let mut groups: HashMap<String, Vec<Value>> = HashMap::new();

    for event in events {
        let data = event
            .data_json
            .clone()
            .unwrap_or_else(|| Value::String(event.data_raw.clone()));

        groups
            .entry(event.event_type.clone())
            .or_default()
            .push(data);
    }

    let mut map = Map::new();
    for (event_type, values) in groups {
        map.insert(event_type, Value::Array(values));
    }
    Value::Object(map)
}

/// Validate SSE events against expectations. Returns a list of
/// error messages (empty = all passed).
pub fn validate_sse(
    events: &[SseEvent],
    expect: &SseExpectation,
    expand_fn: &dyn Fn(&str) -> String,
) -> (Vec<String>, HashMap<String, Value>) {
    let mut errors = Vec::new();
    let mut saved_vars: HashMap<String, Value> = HashMap::new();

    let event_types: Vec<&str> =
        events.iter().map(|e| e.event_type.as_str()).collect();

    // Level 1: has_events — check that each required event type
    // appears at least once
    for required in &expect.has_events {
        if !event_types.contains(&required.as_str()) {
            errors.push(format!(
                "SSE: expected event type '{required}' not found \
                 (found: {event_types:?})"
            ));
        }
    }

    // Level 1: has_no_events — check that forbidden event types are
    // absent
    for forbidden in &expect.has_no_events {
        if event_types.contains(&forbidden.as_str()) {
            errors.push(format!(
                "SSE: forbidden event type '{forbidden}' was found in stream"
            ));
        }
    }

    // Level 1.5: event_count — assert total number of events
    if let Some(expected_count) = expect.event_count {
        let actual_count = events.len();
        if actual_count != expected_count {
            errors.push(format!(
                "SSE event_count mismatch — expected: {expected_count}, \
                 actual: {actual_count}"
            ));
        }
    }

    // Level 1.5: event_count_by_type — assert per-type counts
    if !expect.event_count_by_type.is_empty() {
        let mut actual_counts: HashMap<&str, usize> = HashMap::new();
        for event in events {
            *actual_counts.entry(event.event_type.as_str()).or_insert(0) +=
                1;
        }
        for (event_type, expected_count) in &expect.event_count_by_type {
            let actual_count = actual_counts
                .get(event_type.as_str())
                .copied()
                .unwrap_or(0);
            if actual_count != *expected_count {
                errors.push(format!(
                    "SSE event_count_by_type '{event_type}' mismatch \
                     — expected: {expected_count}, actual: {actual_count}"
                ));
            }
        }
    }

    // Level 1.5: event_sequence — match with consecutive dedup
    if !expect.event_sequence.is_empty() {
        let actual_raw: Vec<&str> =
            events.iter().map(|e| e.event_type.as_str()).collect();
        // Collapse consecutive same-type events for comparison.
        // SSE streams often emit multiple chunks of the same type
        // (e.g. streaming "say" text), so we compare event type
        // transitions rather than exact counts.
        let mut actual: Vec<&str> = Vec::new();
        for &event_type in &actual_raw {
            if actual.last().copied() != Some(event_type) {
                actual.push(event_type);
            }
        }
        let expected: Vec<&str> =
            expect.event_sequence.iter().map(|s| s.as_str()).collect();
        if actual != expected {
            errors.push(format!(
                "SSE event_sequence mismatch — expected: {expected:?}, \
                 actual (deduped): {actual:?} (raw: {actual_raw:?})"
            ));
        }
    }

    // Level 1.5: exact_event_sequence — match without dedup
    if !expect.exact_event_sequence.is_empty() {
        let actual: Vec<&str> =
            events.iter().map(|e| e.event_type.as_str()).collect();
        let expected: Vec<&str> = expect
            .exact_event_sequence
            .iter()
            .map(|s| s.as_str())
            .collect();
        if actual != expected {
            errors.push(format!(
                "SSE exact_event_sequence mismatch — expected: \
                 {expected:?}, actual: {actual:?}"
            ));
        }
    }

    // Level 1.5: ends_with — assert last event type
    if let Some(ref expected_last) = expect.ends_with {
        match events.last() {
            Some(last_event) => {
                if last_event.event_type != *expected_last {
                    errors.push(format!(
                        "SSE ends_with mismatch — expected last event: \
                         '{expected_last}', actual: '{}'",
                        last_event.event_type
                    ));
                }
            }
            None => {
                errors.push(format!(
                    "SSE ends_with: no events in stream, \
                     expected '{expected_last}'"
                ));
            }
        }
    }

    // Level 2: ordered event assertions
    if !expect.events.is_empty() {
        validate_ordered_events(
            events,
            &expect.events,
            expand_fn,
            &mut errors,
            &mut saved_vars,
        );
    }

    (errors, saved_vars)
}

fn validate_ordered_events(
    events: &[SseEvent],
    expectations: &[SseEventExpectation],
    expand_fn: &dyn Fn(&str) -> String,
    errors: &mut Vec<String>,
    saved_vars: &mut HashMap<String, Value>,
) {
    let mut event_cursor = 0;

    for (exp_idx, exp) in expectations.iter().enumerate() {
        let expanded_event = expand_fn(&exp.event);

        // Scan forward from cursor for a matching event type
        let mut found = false;
        while event_cursor < events.len() {
            if events[event_cursor].event_type == expanded_event {
                found = true;
                break;
            }
            event_cursor += 1;
        }

        if !found {
            errors.push(format!(
                "SSE event[{exp_idx}]: expected event '{expanded_event}' not found \
                 after scanning from position"
            ));
            continue;
        }

        let event = &events[event_cursor];

        // data field exact-match checks
        if !exp.data.is_empty() {
            if let Some(json) = &event.data_json {
                for (key, expected_val) in &exp.data {
                    let expanded_expected =
                        expand_value(expected_val, expand_fn, saved_vars);
                    match json.get(key) {
                        Some(actual) => {
                            if *actual != expanded_expected {
                                errors.push(format!(
                                    "SSE event[{exp_idx}] '{expanded_event}': field '{key}' \
                                     mismatch — expected {expanded_expected:?}, \
                                     got {actual:?}"
                                ));
                            }
                        }
                        None => {
                            errors.push(format!(
                                "SSE event[{exp_idx}] '{expanded_event}': field '{key}' \
                                 not found in data"
                            ));
                        }
                    }
                }
            } else {
                errors.push(format!(
                    "SSE event[{exp_idx}] '{expanded_event}': data is not valid JSON, \
                     cannot check fields"
                ));
            }
        }

        // data_eq — full equality check with ignore_fields
        if let Some(ref exact_expected) = exp.data_eq {
            if let Some(json) = &event.data_json {
                // Auto-inject "type" from event name
                let mut expected_with_type = exact_expected.clone();
                if let Value::Object(ref mut map) = expected_with_type {
                    map.entry("type".to_string())
                        .or_insert(Value::String(expanded_event.clone()));
                }
                // Recursively expand {{variables}}
                let expanded = expand_value_deep(
                    &expected_with_type,
                    expand_fn,
                    saved_vars,
                );
                let exact_errors = crate::validator::validate_data_eq(
                    json,
                    &expanded,
                    &exp.ignore_fields,
                    "",
                );
                for e in exact_errors {
                    errors.push(format!(
                        "SSE event[{exp_idx}] '{expanded_event}': {e}"
                    ));
                }
            } else {
                errors.push(format!(
                    "SSE event[{exp_idx}] '{expanded_event}': data is not valid \
                     JSON, cannot run data_eq check"
                ));
            }
        }

        // data_contains — substring match on raw data
        if let Some(substr) = &exp.data_contains {
            let expanded_substr = expand_fn(substr);
            if !event.data_raw.contains(&expanded_substr) {
                errors.push(format!(
                    "SSE event[{exp_idx}] '{expanded_event}': data does not contain '{expanded_substr}'"
                ));
            }
        }

        // data_exists — check field presence
        for field in &exp.data_exists {
            if let Some(json) = &event.data_json {
                if json.get(field).is_none() {
                    errors.push(format!(
                        "SSE event[{exp_idx}] '{expanded_event}': expected field '{field}' \
                         to exist in data"
                    ));
                }
            } else {
                errors.push(format!(
                    "SSE event[{exp_idx}] '{expanded_event}': data is not valid JSON, \
                     cannot check field existence for '{field}'"
                ));
            }
        }

        // save — extract values from this event's data
        for (var_name, data_field) in &exp.save {
            if let Some(json) = &event.data_json {
                if let Some(val) = get_by_path(json, data_field) {
                    saved_vars.insert(var_name.clone(), val.clone());
                } else {
                    errors.push(format!(
                        "SSE event[{exp_idx}] '{expanded_event}': save field '{data_field}' not \
                         found in data"
                    ));
                }
            }
        }

        // Advance cursor past this matched event
        event_cursor += 1;
    }
}

/// Expand `{{var}}` placeholders in a JSON Value.
fn expand_value(
    val: &Value,
    expand_fn: &dyn Fn(&str) -> String,
    saved_vars: &HashMap<String, Value>,
) -> Value {
    match val {
        Value::String(s) => {
            // Check if the entire string is a single placeholder
            let placeholder_re =
                Regex::new(r"^\{\{\s*(\w+)\s*\}\}$").unwrap();
            if let Some(caps) = placeholder_re.captures(s) {
                let var_name = caps.get(1).unwrap().as_str();
                if let Some(saved) = saved_vars.get(var_name) {
                    return saved.clone();
                }
            }

            let expanded = expand_fn(s);
            Value::String(expanded)
        }
        _ => val.clone(),
    }
}

/// Recursively expand `{{var}}` placeholders in all string values
/// within a JSON tree (objects, arrays, nested).
fn expand_value_deep(
    val: &Value,
    expand_fn: &dyn Fn(&str) -> String,
    saved_vars: &HashMap<String, Value>,
) -> Value {
    match val {
        Value::String(_) => expand_value(val, expand_fn, saved_vars),
        Value::Object(map) => {
            let mut new_map = Map::new();
            for (k, v) in map {
                new_map.insert(
                    k.clone(),
                    expand_value_deep(v, expand_fn, saved_vars),
                );
            }
            Value::Object(new_map)
        }
        Value::Array(arr) => {
            let new_arr: Vec<Value> = arr
                .iter()
                .map(|v| expand_value_deep(v, expand_fn, saved_vars))
                .collect();
            Value::Array(new_arr)
        }
        _ => val.clone(),
    }
}

/// Navigate into a JSON value by dot-separated path.
fn get_by_path<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    // Strip JSONPath root accessor prefix (e.g. "$.foo" → "foo")
    let path = path
        .strip_prefix("$.")
        .or_else(|| path.strip_prefix('$'))
        .unwrap_or(path);
    let mut current = value;
    for part in path.split('.') {
        if part.is_empty() {
            continue;
        }
        match current {
            Value::Object(map) => {
                current = map.get(part)?;
            }
            Value::Array(arr) => {
                let idx = part.parse::<usize>().ok()?;
                current = arr.get(idx)?;
            }
            _ => return None,
        }
    }
    Some(current)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample_sse_body() -> &'static str {
        "event: say\n\
         data: {\"index\":0,\"text\":\"Hello\"}\n\
         \n\
         event: tool_call\n\
         data: {\"tool_id\":\"tc_001\",\"tool_name\":\"execute_command\"}\n\
         \n\
         event: tool_call_args\n\
         data: {\"tool_id\":\"tc_001\",\"args\":\"echo hello\"}\n\
         \n\
         event: tool_result\n\
         data: {\"tool_id\":\"tc_001\",\"output\":\"hello\",\"is_finished\":true}\n\
         \n\
         event: usage\n\
         data: {\"prompt_tokens\":100,\"completion_tokens\":50,\"total_tokens\":150,\"total_cost\":0.003}\n\
         \n\
         event: done\n\
         data: {}\n"
    }

    #[test]
    fn test_parse_sse_events() {
        let events = parse_sse_events(sample_sse_body());
        assert_eq!(events.len(), 6);
        assert_eq!(events[0].event_type, "say");
        assert_eq!(events[1].event_type, "tool_call");
        assert_eq!(events[2].event_type, "tool_call_args");
        assert_eq!(events[3].event_type, "tool_result");
        assert_eq!(events[4].event_type, "usage");
        assert_eq!(events[5].event_type, "done");

        // Check parsed JSON
        let tc = events[1].data_json.as_ref().unwrap();
        assert_eq!(tc["tool_id"], json!("tc_001"));
        assert_eq!(tc["tool_name"], json!("execute_command"));
    }

    #[test]
    fn test_parse_sse_events_no_trailing_blank() {
        let body = "event: done\ndata: {}";
        let events = parse_sse_events(body);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, "done");
    }

    #[test]
    fn test_build_sse_value() {
        let events = parse_sse_events(sample_sse_body());
        let value = build_sse_value(&events);

        assert!(value.get("say").is_some());
        assert!(value.get("tool_call").is_some());
        assert!(value.get("usage").is_some());
        assert!(value.get("done").is_some());

        let usage_arr = value["usage"].as_array().unwrap();
        assert_eq!(usage_arr.len(), 1);
        assert_eq!(usage_arr[0]["prompt_tokens"], json!(100));
    }

    #[test]
    fn test_validate_event_sequence_pass() {
        let events = parse_sse_events(sample_sse_body());
        let expect = SseExpectation {
            event_sequence: vec![
                "say".into(),
                "tool_call".into(),
                "tool_call_args".into(),
                "tool_result".into(),
                "usage".into(),
                "done".into(),
            ],
            ..Default::default()
        };

        let identity = |s: &str| s.to_string();
        let (errors, _) = validate_sse(&events, &expect, &identity);
        assert!(errors.is_empty(), "Errors: {errors:?}");
    }

    #[test]
    fn test_validate_event_sequence_mismatch() {
        let events = parse_sse_events(sample_sse_body());
        // Wrong order
        let expect = SseExpectation {
            event_sequence: vec!["done".into(), "usage".into()],
            ..Default::default()
        };

        let identity = |s: &str| s.to_string();
        let (errors, _) = validate_sse(&events, &expect, &identity);
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains("event_sequence mismatch"));
    }

    #[test]
    fn test_validate_event_sequence_dedup() {
        // Simulate streaming: multiple consecutive "say" events
        let body = "\
            event: say\ndata: {\"text\":\"H\"}\n\n\
            event: say\ndata: {\"text\":\"e\"}\n\n\
            event: say\ndata: {\"text\":\"l\"}\n\n\
            event: say\ndata: {\"text\":\"l\"}\n\n\
            event: say\ndata: {\"text\":\"o\"}\n\n\
            event: done\ndata: {}\n\n";
        let events = parse_sse_events(body);

        // After dedup, sequence should be ["say", "done"]
        let expect = SseExpectation {
            event_sequence: vec!["say".into(), "done".into()],
            ..Default::default()
        };

        let identity = |s: &str| s.to_string();
        let (errors, _) = validate_sse(&events, &expect, &identity);
        assert!(errors.is_empty(), "Errors: {errors:?}");
    }

    #[test]
    fn test_validate_has_events() {
        let events = parse_sse_events(sample_sse_body());
        let expect = SseExpectation {
            has_events: vec![
                "tool_call".into(),
                "usage".into(),
                "done".into(),
            ],
            has_no_events: vec!["error".into()],
            events: vec![],
            ..Default::default()
        };

        let identity = |s: &str| s.to_string();
        let (errors, _) = validate_sse(&events, &expect, &identity);
        assert!(errors.is_empty(), "Errors: {errors:?}");
    }

    #[test]
    fn test_validate_has_events_missing() {
        let events = parse_sse_events(sample_sse_body());
        let expect = SseExpectation {
            has_events: vec!["nonexistent".into()],
            ..Default::default()
        };

        let identity = |s: &str| s.to_string();
        let (errors, _) = validate_sse(&events, &expect, &identity);
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains("nonexistent"));
    }

    #[test]
    fn test_validate_has_no_events_violation() {
        let events = parse_sse_events(sample_sse_body());
        let expect = SseExpectation {
            has_no_events: vec!["usage".into()],
            ..Default::default()
        };

        let identity = |s: &str| s.to_string();
        let (errors, _) = validate_sse(&events, &expect, &identity);
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains("forbidden"));
    }

    #[test]
    fn test_validate_ordered_events_with_save() {
        let events = parse_sse_events(sample_sse_body());

        let mut save_tc = HashMap::new();
        save_tc.insert("tc_id".to_string(), "tool_id".to_string());

        let mut data_tc_args = HashMap::new();
        data_tc_args.insert("tool_id".to_string(), json!("{{tc_id}}"));

        let expect = SseExpectation {
            events: vec![
                SseEventExpectation {
                    event: "tool_call".into(),
                    data: {
                        let mut m = HashMap::new();
                        m.insert(
                            "tool_name".to_string(),
                            json!("execute_command"),
                        );
                        m
                    },
                    data_eq: None,
                    ignore_fields: vec![],
                    data_contains: None,
                    data_exists: vec![],
                    save: save_tc,
                },
                SseEventExpectation {
                    event: "tool_call_args".into(),
                    data: data_tc_args,
                    data_eq: None,
                    ignore_fields: vec![],
                    data_contains: None,
                    data_exists: vec![],
                    save: HashMap::new(),
                },
                SseEventExpectation {
                    event: "tool_result".into(),
                    data: {
                        let mut m = HashMap::new();
                        m.insert("tool_id".to_string(), json!("{{tc_id}}"));
                        m
                    },
                    data_eq: None,
                    ignore_fields: vec![],
                    data_contains: Some("hello".into()),
                    data_exists: vec![],
                    save: HashMap::new(),
                },
                SseEventExpectation {
                    event: "usage".into(),
                    data: HashMap::new(),
                    data_eq: None,
                    ignore_fields: vec![],
                    data_contains: None,
                    data_exists: vec![
                        "prompt_tokens".into(),
                        "completion_tokens".into(),
                        "total_cost".into(),
                    ],
                    save: HashMap::new(),
                },
                SseEventExpectation {
                    event: "done".into(),
                    data: HashMap::new(),
                    data_eq: None,
                    ignore_fields: vec![],
                    data_contains: None,
                    data_exists: vec![],
                    save: HashMap::new(),
                },
            ],
            ..Default::default()
        };

        let identity = |s: &str| s.to_string();
        let (errors, saved) = validate_sse(&events, &expect, &identity);
        assert!(errors.is_empty(), "Errors: {errors:?}");
        assert_eq!(saved["tc_id"], json!("tc_001"));
    }

    #[test]
    fn test_validate_data_mismatch() {
        let events = parse_sse_events(sample_sse_body());
        let expect = SseExpectation {
            events: vec![SseEventExpectation {
                event: "tool_call".into(),
                data: {
                    let mut m = HashMap::new();
                    m.insert("tool_name".to_string(), json!("wrong_tool"));
                    m
                },
                data_eq: None,
                ignore_fields: vec![],
                data_contains: None,
                data_exists: vec![],
                save: HashMap::new(),
            }],
            ..Default::default()
        };

        let identity = |s: &str| s.to_string();
        let (errors, _) = validate_sse(&events, &expect, &identity);
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains("mismatch"));
    }

    #[test]
    fn test_validate_data_contains_failure() {
        let events = parse_sse_events(sample_sse_body());
        let expect = SseExpectation {
            events: vec![SseEventExpectation {
                event: "tool_result".into(),
                data: HashMap::new(),
                data_eq: None,
                ignore_fields: vec![],
                data_contains: Some("not_found_text".into()),
                data_exists: vec![],
                save: HashMap::new(),
            }],
            ..Default::default()
        };

        let identity = |s: &str| s.to_string();
        let (errors, _) = validate_sse(&events, &expect, &identity);
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains("does not contain"));
    }

    #[test]
    fn test_validate_event_not_found() {
        let events = parse_sse_events("event: done\ndata: {}\n\n");
        let expect = SseExpectation {
            events: vec![SseEventExpectation {
                event: "tool_call".into(),
                data: HashMap::new(),
                data_eq: None,
                ignore_fields: vec![],
                data_contains: None,
                data_exists: vec![],
                save: HashMap::new(),
            }],
            ..Default::default()
        };

        let identity = |s: &str| s.to_string();
        let (errors, _) = validate_sse(&events, &expect, &identity);
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains("not found"));
    }

    // ── event_count tests ─────────────────────────────────

    #[test]
    fn test_validate_event_count_pass() {
        let events = parse_sse_events(sample_sse_body());
        let expect = SseExpectation {
            event_count: Some(6),
            ..Default::default()
        };
        let identity = |s: &str| s.to_string();
        let (errors, _) = validate_sse(&events, &expect, &identity);
        assert!(errors.is_empty(), "Errors: {errors:?}");
    }

    #[test]
    fn test_validate_event_count_mismatch() {
        let events = parse_sse_events(sample_sse_body());
        let expect = SseExpectation {
            event_count: Some(3),
            ..Default::default()
        };
        let identity = |s: &str| s.to_string();
        let (errors, _) = validate_sse(&events, &expect, &identity);
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains("event_count mismatch"));
        assert!(errors[0].contains("expected: 3"));
        assert!(errors[0].contains("actual: 6"));
    }

    // ── event_count_by_type tests ─────────────────────────

    #[test]
    fn test_validate_event_count_by_type_pass() {
        let events = parse_sse_events(sample_sse_body());
        let mut counts = HashMap::new();
        counts.insert("say".to_string(), 1);
        counts.insert("tool_call".to_string(), 1);
        counts.insert("done".to_string(), 1);
        let expect = SseExpectation {
            event_count_by_type: counts,
            ..Default::default()
        };
        let identity = |s: &str| s.to_string();
        let (errors, _) = validate_sse(&events, &expect, &identity);
        assert!(errors.is_empty(), "Errors: {errors:?}");
    }

    #[test]
    fn test_validate_event_count_by_type_mismatch() {
        let events = parse_sse_events(sample_sse_body());
        let mut counts = HashMap::new();
        counts.insert("say".to_string(), 3); // only 1 in stream
        let expect = SseExpectation {
            event_count_by_type: counts,
            ..Default::default()
        };
        let identity = |s: &str| s.to_string();
        let (errors, _) = validate_sse(&events, &expect, &identity);
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains("event_count_by_type 'say'"));
        assert!(errors[0].contains("expected: 3"));
        assert!(errors[0].contains("actual: 1"));
    }

    #[test]
    fn test_validate_event_count_by_type_missing_type() {
        let events = parse_sse_events(sample_sse_body());
        let mut counts = HashMap::new();
        counts.insert("error".to_string(), 1); // not in stream
        let expect = SseExpectation {
            event_count_by_type: counts,
            ..Default::default()
        };
        let identity = |s: &str| s.to_string();
        let (errors, _) = validate_sse(&events, &expect, &identity);
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains("actual: 0"));
    }

    // ── exact_event_sequence tests ────────────────────────

    #[test]
    fn test_validate_exact_event_sequence_pass() {
        let events = parse_sse_events(sample_sse_body());
        let expect = SseExpectation {
            exact_event_sequence: vec![
                "say".into(),
                "tool_call".into(),
                "tool_call_args".into(),
                "tool_result".into(),
                "usage".into(),
                "done".into(),
            ],
            ..Default::default()
        };
        let identity = |s: &str| s.to_string();
        let (errors, _) = validate_sse(&events, &expect, &identity);
        assert!(errors.is_empty(), "Errors: {errors:?}");
    }

    #[test]
    fn test_validate_exact_event_sequence_no_dedup() {
        // Unlike event_sequence, exact_event_sequence does NOT dedup
        let body = "\
            event: say\ndata: {\"text\":\"H\"}\n\n\
            event: say\ndata: {\"text\":\"i\"}\n\n\
            event: done\ndata: {}\n\n";
        let events = parse_sse_events(body);

        // This should fail because exact requires [say, say, done]
        let expect = SseExpectation {
            exact_event_sequence: vec!["say".into(), "done".into()],
            ..Default::default()
        };
        let identity = |s: &str| s.to_string();
        let (errors, _) = validate_sse(&events, &expect, &identity);
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains("exact_event_sequence mismatch"));

        // This should pass
        let expect_exact = SseExpectation {
            exact_event_sequence: vec![
                "say".into(),
                "say".into(),
                "done".into(),
            ],
            ..Default::default()
        };
        let (errors, _) = validate_sse(&events, &expect_exact, &identity);
        assert!(errors.is_empty(), "Errors: {errors:?}");
    }

    // ── ends_with tests ───────────────────────────────────

    #[test]
    fn test_validate_ends_with_pass() {
        let events = parse_sse_events(sample_sse_body());
        let expect = SseExpectation {
            ends_with: Some("done".into()),
            ..Default::default()
        };
        let identity = |s: &str| s.to_string();
        let (errors, _) = validate_sse(&events, &expect, &identity);
        assert!(errors.is_empty(), "Errors: {errors:?}");
    }

    #[test]
    fn test_validate_ends_with_mismatch() {
        let events = parse_sse_events(sample_sse_body());
        let expect = SseExpectation {
            ends_with: Some("usage".into()),
            ..Default::default()
        };
        let identity = |s: &str| s.to_string();
        let (errors, _) = validate_sse(&events, &expect, &identity);
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains("ends_with mismatch"));
        assert!(errors[0].contains("expected last event: 'usage'"));
        assert!(errors[0].contains("actual: 'done'"));
    }

    #[test]
    fn test_validate_ends_with_empty_stream() {
        let events: Vec<SseEvent> = vec![];
        let expect = SseExpectation {
            ends_with: Some("done".into()),
            ..Default::default()
        };
        let identity = |s: &str| s.to_string();
        let (errors, _) = validate_sse(&events, &expect, &identity);
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains("no events in stream"));
    }

    // ── combined validation test ──────────────────────────

    #[test]
    fn test_validate_combined_new_features() {
        let events = parse_sse_events(sample_sse_body());
        let mut counts = HashMap::new();
        counts.insert("say".to_string(), 1);
        counts.insert("done".to_string(), 1);
        let expect = SseExpectation {
            event_count: Some(6),
            event_count_by_type: counts,
            exact_event_sequence: vec![
                "say".into(),
                "tool_call".into(),
                "tool_call_args".into(),
                "tool_result".into(),
                "usage".into(),
                "done".into(),
            ],
            ends_with: Some("done".into()),
            has_events: vec!["usage".into()],
            has_no_events: vec!["error".into()],
            ..Default::default()
        };
        let identity = |s: &str| s.to_string();
        let (errors, _) = validate_sse(&events, &expect, &identity);
        assert!(errors.is_empty(), "Errors: {errors:?}");
    }
}
