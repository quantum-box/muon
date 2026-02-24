//! TODO: add English documentation

use anyhow::{anyhow, Result};
use serde_json::Value;
use std::collections::HashMap;

/// TODO: add English documentation
pub fn get_by_json_path<'a>(
    json: &'a Value,
    path: &str,
) -> Option<&'a Value> {
    let parts: Vec<&str> = path.split('.').collect();
    let mut current = json;

    for part in parts {
        // Try string key first (objects), then numeric index
        // (arrays).
        let resolved = current.get(part).or_else(|| {
            part.parse::<usize>().ok().and_then(|idx| current.get(idx))
        });
        match resolved {
            Some(value) => current = value,
            None => return None,
        }
    }

    Some(current)
}

/// TODO: add English documentation
pub fn validate_json(
    body: &str,
    expectations: &HashMap<String, Value>,
) -> Result<Vec<String>> {
    let mut errors = Vec::new();

    // TODO: add English comment
    let json: Value = match serde_json::from_str(body) {
        Ok(json) => json,
        Err(e) => {
            return Err(anyhow!("JSONパースエラー: {e}"));
        }
    };

    // TODO: add English comment
    for (path, expected) in expectations {
        match get_by_json_path(&json, path) {
            Some(actual) => {
                if actual != expected {
                    errors.push(format!(
                        "JSONパス '{path}' の値が期待値と一致しません。期待: {expected:?}, 実際: {actual:?}"
                    ));
                }
            }
            None => {
                errors.push(format!(
                    "JSONパス '{path}' がレスポンスに存在しません"
                ));
            }
        }
    }

    Ok(errors)
}

/// TODO: add English documentation
pub fn validate_contains(body: &str, texts: &[String]) -> Vec<String> {
    let mut errors = Vec::new();

    for text in texts {
        if !body.contains(text) {
            errors.push(format!(
                "レスポンスボディに期待するテキスト '{text}' が含まれていません"
            ));
        }
    }

    errors
}

/// Check whether the given dot-separated path should be ignored.
///
/// Each segment of `path` is compared against each segment of each
/// ignore pattern. The wildcard `*` in a pattern matches any single
/// segment (including numeric array indices).
fn is_field_ignored(path: &str, ignore_fields: &[String]) -> bool {
    let path_parts: Vec<&str> = path.split('.').collect();
    for pattern in ignore_fields {
        let pat_parts: Vec<&str> = pattern.split('.').collect();
        if pat_parts.len() != path_parts.len() {
            continue;
        }
        let matched = pat_parts
            .iter()
            .zip(path_parts.iter())
            .all(|(p, a)| *p == "*" || *p == *a);
        if matched {
            return true;
        }
    }
    false
}

/// Recursively compare two JSON values for full equality,
/// skipping fields listed in `ignore_fields`.
///
/// Returns a list of human-readable error strings describing
/// every mismatch found (empty = values are equal).
pub fn validate_data_eq(
    actual: &Value,
    expected: &Value,
    ignore_fields: &[String],
    path_prefix: &str,
) -> Vec<String> {
    if is_field_ignored(path_prefix, ignore_fields) {
        return vec![];
    }

    let mut errors = Vec::new();

    match (actual, expected) {
        (Value::Object(a_map), Value::Object(e_map)) => {
            // Collect all keys from both sides
            let mut all_keys: Vec<&String> =
                a_map.keys().chain(e_map.keys()).collect();
            all_keys.sort();
            all_keys.dedup();

            for key in all_keys {
                let child_path = if path_prefix.is_empty() {
                    key.to_string()
                } else {
                    format!("{path_prefix}.{key}")
                };

                if is_field_ignored(&child_path, ignore_fields) {
                    continue;
                }

                match (a_map.get(key), e_map.get(key)) {
                    (Some(a_val), Some(e_val)) => {
                        errors.extend(validate_data_eq(
                            a_val,
                            e_val,
                            ignore_fields,
                            &child_path,
                        ));
                    }
                    (Some(a_val), None) => {
                        errors.push(format!(
                            "data_eq '{child_path}': unexpected field \
                             (value: {a_val:?})"
                        ));
                    }
                    (None, Some(e_val)) => {
                        errors.push(format!(
                            "data_eq '{child_path}': missing field \
                             (expected: {e_val:?})"
                        ));
                    }
                    (None, None) => unreachable!(),
                }
            }
        }
        (Value::Array(a_arr), Value::Array(e_arr)) => {
            if a_arr.len() != e_arr.len() {
                errors.push(format!(
                    "data_eq '{}': array length mismatch — \
                     expected {}, got {}",
                    path_prefix,
                    e_arr.len(),
                    a_arr.len()
                ));
            }
            let len = std::cmp::min(a_arr.len(), e_arr.len());
            for i in 0..len {
                let child_path = if path_prefix.is_empty() {
                    format!("{i}")
                } else {
                    format!("{path_prefix}.{i}")
                };
                errors.extend(validate_data_eq(
                    &a_arr[i],
                    &e_arr[i],
                    ignore_fields,
                    &child_path,
                ));
            }
        }
        _ => {
            if actual != expected {
                errors.push(format!(
                    "data_eq '{path_prefix}': value mismatch — \
                     expected {expected:?}, got {actual:?}"
                ));
            }
        }
    }

    errors
}

/// TODO: add English documentation
pub fn validate_headers(
    headers: &HashMap<String, String>,
    expectations: &HashMap<String, String>,
) -> Vec<String> {
    let mut errors = Vec::new();

    for (name, expected) in expectations {
        match headers.get(name) {
            Some(actual) => {
                if actual != expected {
                    errors.push(format!(
                        "ヘッダー '{name}' の値が期待値と一致しません。期待: {expected}, 実際: {actual}"
                    ));
                }
            }
            None => {
                errors.push(format!(
                    "ヘッダー '{name}' がレスポンスに存在しません"
                ));
            }
        }
    }

    errors
}
