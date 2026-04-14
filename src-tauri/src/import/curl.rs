//! Parse a curl command string into a muon `TestStep`.

use anyhow::{anyhow, Result};
use muon::model::{
    HttpMethod, HttpRequest, ResponseExpectation, TestStep,
};
use std::collections::HashMap;

/// Parse a curl command into a single `TestStep`.
pub fn parse_curl(input: &str) -> Result<TestStep> {
    let tokens = tokenize(input)?;
    let mut method = HttpMethod::Get;
    let mut url = String::new();
    let mut headers = HashMap::new();
    let mut body: Option<serde_json::Value> = None;
    let mut query = HashMap::new();

    let mut i = 0;
    while i < tokens.len() {
        let token = &tokens[i];
        match token.as_str() {
            "curl" => {
                // skip the command itself
            }
            "-X" | "--request" => {
                i += 1;
                if i < tokens.len() {
                    method = parse_method(&tokens[i]);
                }
            }
            "-H" | "--header" => {
                i += 1;
                if i < tokens.len() {
                    if let Some((k, v)) =
                        tokens[i].split_once(':')
                    {
                        headers.insert(
                            k.trim().to_string(),
                            v.trim().to_string(),
                        );
                    }
                }
            }
            "-d" | "--data" | "--data-raw"
            | "--data-binary" => {
                i += 1;
                if i < tokens.len() {
                    // If no explicit method, -d implies POST
                    if !tokens
                        .iter()
                        .any(|t| t == "-X" || t == "--request")
                    {
                        method = HttpMethod::Post;
                    }
                    body = serde_json::from_str(&tokens[i])
                        .ok()
                        .or_else(|| {
                            Some(serde_json::Value::String(
                                tokens[i].clone(),
                            ))
                        });
                }
            }
            "-u" | "--user" => {
                i += 1;
                if i < tokens.len() {
                    let encoded =
                        super::postman::base64_encode(
                            tokens[i].as_bytes(),
                        );
                    // Calling our postman base64 is fine since
                    // it's in the same crate; alternatively
                    // we could inline it.
                    headers.insert(
                        "Authorization".to_string(),
                        format!("Basic {encoded}"),
                    );
                }
            }
            _ if !token.starts_with('-') && url.is_empty() => {
                // First non-flag token is the URL
                let raw_url = token
                    .trim_matches(|c| c == '\'' || c == '"');
                // Separate query params if present
                if let Some((base, qs)) =
                    raw_url.split_once('?')
                {
                    url = base.to_string();
                    for pair in qs.split('&') {
                        if let Some((k, v)) =
                            pair.split_once('=')
                        {
                            query.insert(
                                k.to_string(),
                                v.to_string(),
                            );
                        }
                    }
                } else {
                    url = raw_url.to_string();
                }
            }
            _ => {
                // Skip unrecognized flags
            }
        }
        i += 1;
    }

    if url.is_empty() {
        return Err(anyhow!("No URL found in curl command"));
    }

    Ok(TestStep {
        name: format!("{} {url}", method_str(&method)),
        id: None,
        description: Some(format!(
            "Imported from curl command"
        )),
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
            not_contains: Vec::new(),
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

/// Tokenize a curl command, handling quoted strings.
fn tokenize(input: &str) -> Result<Vec<String>> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_single = false;
    let mut in_double = false;
    let mut escape_next = false;

    for ch in input.chars() {
        if escape_next {
            current.push(ch);
            escape_next = false;
            continue;
        }

        match ch {
            '\\' if !in_single => {
                escape_next = true;
            }
            '\'' if !in_double => {
                in_single = !in_single;
            }
            '"' if !in_single => {
                in_double = !in_double;
            }
            c if c.is_whitespace()
                && !in_single
                && !in_double =>
            {
                if !current.is_empty() {
                    tokens.push(current.clone());
                    current.clear();
                }
            }
            _ => {
                current.push(ch);
            }
        }
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    Ok(tokens)
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

fn method_str(m: &HttpMethod) -> &'static str {
    match m {
        HttpMethod::Get => "GET",
        HttpMethod::Post => "POST",
        HttpMethod::Put => "PUT",
        HttpMethod::Delete => "DELETE",
        HttpMethod::Patch => "PATCH",
        HttpMethod::Head => "HEAD",
        HttpMethod::Options => "OPTIONS",
    }
}
