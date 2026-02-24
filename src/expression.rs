//! CEL-based expression evaluation engine for runn-compatible
//! `test:` assertions and `bind:` variable resolution.

use anyhow::{anyhow, Result};
use cel::{Context, Program};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tracing::debug;

/// Evaluate a CEL expression string against a variable context.
///
/// Returns `true` if the expression evaluates to a truthy value,
/// `false` otherwise. Non-boolean results (e.g. integers, strings)
/// are coerced: non-zero/non-empty → true.
pub fn evaluate_test(
    expr: &str,
    vars: &HashMap<String, Value>,
) -> Result<bool> {
    let program = compile(expr)?;
    let context = build_context(vars)?;
    let result = program
        .execute(&context)
        .map_err(|e| anyhow!("CEL execution error: {e}"))?;

    Ok(cel_value_is_truthy(&result))
}

/// Resolve a CEL expression to a `serde_json::Value`.
///
/// Used by `bind:` to extract values from the context.
/// For example: `"current.res.body.id"` → the JSON value at
/// that path.
pub fn resolve_value(
    expr: &str,
    vars: &HashMap<String, Value>,
) -> Result<Value> {
    let program = compile(expr)?;
    let context = build_context(vars)?;
    let result = program
        .execute(&context)
        .map_err(|e| anyhow!("CEL execution error: {e}"))?;

    cel_to_json(&result)
}

/// Pre-process an expression to support runn-compatible function
/// aliases.
///
/// Conversions:
/// - `len(x)` → `size(x)`
/// - `type(x)` → `type_of(x)` (avoid CEL keyword clash)
fn preprocess_expr(expr: &str) -> String {
    use regex::Regex;
    use std::sync::LazyLock;

    static LEN_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\blen\(").expect("failed to compile len regex")
    });

    static TYPE_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\btype\(")
            .expect("failed to compile type regex")
    });

    let result = LEN_RE.replace_all(expr, "size(").into_owned();
    let result =
        TYPE_RE.replace_all(&result, "type_of(").into_owned();

    result
}

fn compile(expr: &str) -> Result<Program> {
    let processed = preprocess_expr(expr);
    debug!("Compiling CEL expression: {processed}");
    Program::compile(&processed)
        .map_err(|e| anyhow!("CEL compile error for '{processed}': {e}"))
}

fn build_context<'a>(
    vars: &HashMap<String, Value>,
) -> Result<Context<'a>> {
    let mut context = Context::default();

    for (key, value) in vars {
        context
            .add_variable(key.as_str(), value.clone())
            .map_err(|e| {
                anyhow!(
                    "Failed to add variable '{key}' to CEL context: {e}"
                )
            })?;
    }

    // Register runn-compatible custom functions
    register_custom_functions(&mut context);

    Ok(context)
}

fn register_custom_functions(context: &mut Context<'_>) {
    // compare(a, b) - deep equality check returning bool
    context.add_function(
        "compare",
        |a: cel::Value, b: cel::Value| -> bool { a == b },
    );

    // diff(a, b) - returns string description of differences
    context.add_function(
        "diff",
        |a: cel::Value, b: cel::Value| -> Arc<String> {
            if a == b {
                Arc::new(String::new())
            } else {
                Arc::new(format!("expected {:?}, got {:?}", b, a))
            }
        },
    );

    // type_of(x) - returns type name as string (runn: type())
    context.add_function(
        "type_of",
        |v: cel::Value| -> Arc<String> {
            let t = match v {
                cel::Value::Int(_) => "int",
                cel::Value::UInt(_) => "uint",
                cel::Value::Float(_) => "double",
                cel::Value::String(_) => "string",
                cel::Value::Bool(_) => "bool",
                cel::Value::List(_) => "list",
                cel::Value::Map(_) => "map",
                cel::Value::Null => "null",
                cel::Value::Bytes(_) => "bytes",
                _ => "unknown",
            };
            Arc::new(t.to_string())
        },
    );

    // urlencode(str) - URL-encode a string
    context.add_function(
        "urlencode",
        |s: Arc<String>| -> Arc<String> {
            Arc::new(
                url::form_urlencoded::byte_serialize(s.as_bytes())
                    .collect::<String>(),
            )
        },
    );
}

fn cel_value_is_truthy(value: &cel::Value) -> bool {
    match value {
        cel::Value::Bool(b) => *b,
        cel::Value::Int(i) => *i != 0,
        cel::Value::UInt(u) => *u != 0,
        cel::Value::Float(f) => *f != 0.0,
        cel::Value::String(s) => !s.is_empty(),
        cel::Value::Null => false,
        cel::Value::List(list) => !list.is_empty(),
        cel::Value::Map(map) => !map.map.is_empty(),
        _ => true,
    }
}

fn cel_to_json(value: &cel::Value) -> Result<Value> {
    value
        .json()
        .map_err(|e| anyhow!("Failed to convert CEL value to JSON: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn make_vars(
        pairs: Vec<(&str, Value)>,
    ) -> HashMap<String, Value> {
        pairs
            .into_iter()
            .map(|(k, v)| (k.to_string(), v))
            .collect()
    }

    #[test]
    fn test_simple_comparison() {
        let vars = make_vars(vec![("x", json!(10))]);
        assert!(evaluate_test("x == 10", &vars).unwrap());
        assert!(evaluate_test("x > 5", &vars).unwrap());
        assert!(!evaluate_test("x < 5", &vars).unwrap());
    }

    #[test]
    fn test_logical_operators() {
        let vars = make_vars(vec![("x", json!(10)), ("y", json!(20))]);
        assert!(evaluate_test("x == 10 && y == 20", &vars).unwrap());
        assert!(evaluate_test("x == 10 || y == 99", &vars).unwrap());
        assert!(!evaluate_test("x == 99 && y == 20", &vars).unwrap());
    }

    #[test]
    fn test_nested_object_access() {
        let vars = make_vars(vec![(
            "current",
            json!({
                "res": {
                    "status": 200,
                    "body": {
                        "name": "alice",
                        "items": [1, 2, 3]
                    }
                }
            }),
        )]);

        assert!(
            evaluate_test("current.res.status == 200", &vars).unwrap()
        );
        assert!(evaluate_test(
            "current.res.body.name == \"alice\"",
            &vars
        )
        .unwrap());
        assert!(evaluate_test(
            "size(current.res.body.items) == 3",
            &vars
        )
        .unwrap());
    }

    #[test]
    fn test_len_alias() {
        let vars = make_vars(vec![(
            "items",
            json!([1, 2, 3]),
        )]);
        // `len()` should be preprocessed to `size()`
        assert!(evaluate_test("len(items) == 3", &vars).unwrap());
        assert!(evaluate_test("len(items) > 0", &vars).unwrap());
    }

    #[test]
    fn test_string_functions() {
        let vars = make_vars(vec![(
            "name",
            json!("hello_world"),
        )]);
        assert!(
            evaluate_test("name.contains(\"hello\")", &vars).unwrap()
        );
        assert!(
            evaluate_test("name.startsWith(\"hello\")", &vars).unwrap()
        );
        assert!(
            evaluate_test("name.endsWith(\"world\")", &vars).unwrap()
        );
    }

    #[test]
    fn test_regex_matches() {
        let vars = make_vars(vec![(
            "id",
            json!("us_01abc123"),
        )]);
        assert!(
            evaluate_test("id.matches(\"^us_\")", &vars).unwrap()
        );
        assert!(
            !evaluate_test("id.matches(\"^admin_\")", &vars).unwrap()
        );
    }

    #[test]
    fn test_resolve_value() {
        let vars = make_vars(vec![(
            "res",
            json!({"body": {"id": "user_123", "count": 42}}),
        )]);

        let v = resolve_value("res.body.id", &vars).unwrap();
        assert_eq!(v, json!("user_123"));

        let v = resolve_value("res.body.count", &vars).unwrap();
        assert_eq!(v, json!(42));
    }

    #[test]
    fn test_compare_function() {
        let vars = make_vars(vec![
            ("a", json!({"x": 1})),
            ("b", json!({"x": 1})),
            ("c", json!({"x": 2})),
        ]);
        assert!(evaluate_test("compare(a, b)", &vars).unwrap());
        assert!(!evaluate_test("compare(a, c)", &vars).unwrap());
    }

    #[test]
    fn test_type_of_function() {
        let vars = make_vars(vec![
            ("s", json!("hello")),
            ("n", json!(-5)),   // negative → CEL int
            ("u", json!(42)),   // positive → CEL uint
            ("f", json!(3.14)), // float → CEL double
            ("b", json!(true)),
            ("a", json!([1, 2])),
            ("m", json!({"x": 1})),
        ]);
        assert!(evaluate_test(
            "type_of(s) == \"string\"",
            &vars
        )
        .unwrap());
        assert!(
            evaluate_test("type_of(n) == \"int\"", &vars).unwrap()
        );
        assert!(evaluate_test(
            "type_of(u) == \"uint\"",
            &vars
        )
        .unwrap());
        assert!(evaluate_test(
            "type_of(f) == \"double\"",
            &vars
        )
        .unwrap());
        assert!(evaluate_test(
            "type_of(b) == \"bool\"",
            &vars
        )
        .unwrap());
        assert!(evaluate_test(
            "type_of(a) == \"list\"",
            &vars
        )
        .unwrap());
        assert!(
            evaluate_test("type_of(m) == \"map\"", &vars).unwrap()
        );
    }

    #[test]
    fn test_type_alias() {
        // `type(x)` should be preprocessed to `type_of(x)`
        let vars = make_vars(vec![("x", json!("hello"))]);
        assert!(evaluate_test(
            "type(x) == \"string\"",
            &vars
        )
        .unwrap());
    }

    #[test]
    fn test_has_builtin() {
        let vars = make_vars(vec![(
            "obj",
            json!({"name": "alice", "age": 30}),
        )]);
        assert!(
            evaluate_test("has(obj.name)", &vars).unwrap()
        );
        // has() on non-existent field should return false
        assert!(
            !evaluate_test("has(obj.email)", &vars).unwrap()
        );
    }

    #[test]
    fn test_in_operator() {
        let vars = make_vars(vec![(
            "items",
            json!(["a", "b", "c"]),
        )]);
        assert!(
            evaluate_test("\"a\" in items", &vars).unwrap()
        );
        assert!(
            !evaluate_test("\"z\" in items", &vars).unwrap()
        );
    }

    #[test]
    fn test_ternary_operator() {
        let vars = make_vars(vec![("x", json!(10))]);
        let v =
            resolve_value("x > 5 ? \"big\" : \"small\"", &vars)
                .unwrap();
        assert_eq!(v, json!("big"));
    }

    #[test]
    fn test_compile_error() {
        let vars = HashMap::new();
        let result = evaluate_test("invalid %%% expr", &vars);
        assert!(result.is_err());
    }

    #[test]
    fn test_urlencode_function() {
        let vars = make_vars(vec![(
            "q",
            json!("hello world&foo=bar"),
        )]);
        let v = resolve_value("urlencode(q)", &vars).unwrap();
        assert_eq!(v, json!("hello+world%26foo%3Dbar"));
    }

    #[test]
    fn test_runn_style_expression() {
        // Simulate a full runn-style test expression
        let vars = make_vars(vec![(
            "current",
            json!({
                "res": {
                    "status": 201,
                    "body": {
                        "id": "us_01abc",
                        "name": "alice",
                        "roles": ["admin", "user"]
                    },
                    "headers": {
                        "content-type": "application/json"
                    }
                }
            }),
        )]);

        assert!(evaluate_test(
            r#"current.res.status == 201
            && current.res.body.name == "alice"
            && size(current.res.body.roles) > 0
            && current.res.body.id.startsWith("us_")"#,
            &vars,
        )
        .unwrap());
    }
}
