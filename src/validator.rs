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
        match current.get(part) {
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
            return Err(anyhow!("JSONパースエラー: {}", e));
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
