use std::{fs, path::PathBuf};

use axum::{http::StatusCode, routing::get, Json, Router};
use muon::{DefaultTestRunner, TestRunner, TestScenario};
use serde_json::json;
use tokio::task::JoinHandle;

struct TestServer {
    base_url: String,
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
    handle: Option<JoinHandle<()>>,
}

impl TestServer {
    async fn spawn() -> Self {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("failed to bind ephemeral port");
        let addr = listener.local_addr().unwrap();

        let app = Router::new()
            .route(
                "/sample",
                get(|| async move {
                    Json(json!({
                        "data": {
                            "kind": "list",
                            "items": [
                                {"id": "item-1"},
                                {"id": "item-2"}
                            ],
                            "map": {
                                "a": 1,
                                "b": 2,
                                "c": 3
                            }
                        }
                    }))
                }),
            )
            .route("/text", get(|| async move { "Hello runner world" }))
            .route(
                "/nested",
                get(|| async move {
                    Json(json!({
                        "data": {
                            "groups": [
                                {
                                    "name": "alpha",
                                    "members": ["u1", "u2"],
                                    "tags": []
                                },
                                {
                                    "name": "beta",
                                    "members": ["u3"],
                                    "tags": ["active"]
                                }
                            ]
                        }
                    }))
                }),
            )
            .route(
                "/empty",
                get(|| async move {
                    Json(json!({
                        "data": {
                            "kind": "empty",
                            "items": [],
                            "map": {}
                        }
                    }))
                }),
            )
            .route(
                "/object",
                get(|| async move {
                    Json(json!({
                        "data": {
                            "entries": {
                                "one": {"value": 1},
                                "two": {"value": 2},
                                "three": {"value": 3},
                                "four": {"value": 4}
                            }
                        }
                    }))
                }),
            )
            .route(
                "/headers",
                get(|| async move {
                    (
                        [
                            ("X-Test-Header", "ok"),
                            ("Content-Type", "application/json"),
                        ],
                        Json(json!({
                            "data": {
                                "message": "header response"
                            }
                        })),
                    )
                }),
            )
            .route(
                "/created",
                get(|| async move {
                    (
                        StatusCode::CREATED,
                        Json(json!({
                            "data": {
                                "created": true
                            }
                        })),
                    )
                }),
            );

        let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();
        let server = axum::serve(listener, app.into_make_service())
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            });

        let handle = tokio::spawn(async move {
            if let Err(err) = server.await {
                eprintln!("test server error: {err}");
            }
        });
        let base_url = format!("http://{addr}");

        Self {
            base_url,
            shutdown_tx: Some(shutdown_tx),
            handle: Some(handle),
        }
    }

    async fn shutdown(mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        if let Some(handle) = self.handle.take() {
            if !handle.is_finished() {
                let _ = handle.await;
            }
        }
    }
}

impl Drop for TestServer {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        if let Some(handle) = self.handle.take() {
            handle.abort();
        }
    }
}

fn load_scenario(path: &str, base_url: &str) -> TestScenario {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let scenario_path = manifest_dir.join("tests/fixtures").join(path);
    let content = fs::read_to_string(&scenario_path).unwrap_or_else(|e| {
        panic!("failed to read {scenario_path:?}: {e}")
    });
    let content = content.replace("__BASE_URL__", base_url);

    if path.ends_with(".scenario.md") {
        TestScenario::from_markdown(&content).unwrap_or_else(|e| {
            panic!("failed to parse scenario markdown: {e}")
        })
    } else {
        TestScenario::from_yaml(&content).unwrap_or_else(|e| {
            panic!("failed to parse scenario yaml: {e}")
        })
    }
}

#[tokio::test]
async fn json_lengths_succeeds_for_arrays_and_objects() {
    let server = TestServer::spawn().await;
    let scenario =
        load_scenario("json_lengths_success.yaml", &server.base_url);
    let runner = DefaultTestRunner::new();

    let result = runner
        .run(&scenario)
        .await
        .expect("runner returned error for success scenario");

    assert!(
        result.success,
        "scenario should succeed: {:?}",
        result.error
    );

    server.shutdown().await;
}

#[tokio::test]
async fn json_lengths_succeeds_for_nested_paths() {
    let server = TestServer::spawn().await;
    let scenario =
        load_scenario("json_lengths_nested.yaml", &server.base_url);
    let runner = DefaultTestRunner::new();

    let result = runner
        .run(&scenario)
        .await
        .expect("runner returned error for nested success scenario");

    assert!(
        result.success,
        "scenario should succeed: {:?}",
        result.error
    );

    server.shutdown().await;
}

#[tokio::test]
async fn json_lengths_succeeds_for_zero_length_collections() {
    let server = TestServer::spawn().await;
    let scenario =
        load_scenario("json_lengths_zero.yaml", &server.base_url);
    let runner = DefaultTestRunner::new();

    let result = runner
        .run(&scenario)
        .await
        .expect("runner returned error for zero-length scenario");

    assert!(
        result.success,
        "scenario should succeed: {:?}",
        result.error
    );

    server.shutdown().await;
}

#[tokio::test]
async fn json_lengths_succeeds_for_objects() {
    let server = TestServer::spawn().await;
    let scenario =
        load_scenario("json_lengths_object_success.yaml", &server.base_url);
    let runner = DefaultTestRunner::new();

    let result = runner
        .run(&scenario)
        .await
        .expect("runner returned error for object success scenario");

    assert!(
        result.success,
        "scenario should succeed: {:?}",
        result.error
    );

    server.shutdown().await;
}

#[tokio::test]
async fn contains_succeeds_for_substring() {
    let server = TestServer::spawn().await;
    let scenario = load_scenario("contains_success.yaml", &server.base_url);
    let runner = DefaultTestRunner::new();

    let result = runner
        .run(&scenario)
        .await
        .expect("runner returned error for contains success");

    assert!(
        result.success,
        "scenario should succeed: {:?}",
        result.error
    );

    server.shutdown().await;
}

#[tokio::test]
async fn headers_succeed_when_values_match() {
    let server = TestServer::spawn().await;
    let scenario = load_scenario("headers_success.yaml", &server.base_url);
    let runner = DefaultTestRunner::new();

    let result = runner
        .run(&scenario)
        .await
        .expect("runner returned error for header success");

    assert!(
        result.success,
        "scenario should succeed: {:?}",
        result.error
    );

    server.shutdown().await;
}

#[tokio::test]
async fn json_match_succeeds_for_exact_values() {
    let server = TestServer::spawn().await;
    let scenario =
        load_scenario("json_match_success.yaml", &server.base_url);
    let runner = DefaultTestRunner::new();

    let result = runner
        .run(&scenario)
        .await
        .expect("runner returned error for json match success");

    assert!(
        result.success,
        "scenario should succeed: {:?}",
        result.error
    );

    server.shutdown().await;
}

#[tokio::test]
async fn json_lengths_fails_for_non_collection_values() {
    let server = TestServer::spawn().await;
    let scenario =
        load_scenario("json_lengths_wrong_type.yaml", &server.base_url);
    let runner = DefaultTestRunner::new();

    let result = runner
        .run(&scenario)
        .await
        .expect("runner returned error for failure scenario");

    assert!(!result.success, "scenario should fail");
    assert_error_contains(&result, "配列またはオブジェクトではありません");

    server.shutdown().await;
}

#[tokio::test]
async fn json_lengths_fails_for_array_length_mismatch() {
    let server = TestServer::spawn().await;
    let scenario =
        load_scenario("json_lengths_array_mismatch.yaml", &server.base_url);
    let runner = DefaultTestRunner::new();

    let result = runner
        .run(&scenario)
        .await
        .expect("runner returned error for mismatch scenario");

    assert!(!result.success, "scenario should fail");
    assert_error_contains(&result, "配列長が一致しません");

    server.shutdown().await;
}

#[tokio::test]
async fn json_lengths_fails_for_object_length_mismatch() {
    let server = TestServer::spawn().await;
    let scenario = load_scenario(
        "json_lengths_object_mismatch.yaml",
        &server.base_url,
    );
    let runner = DefaultTestRunner::new();

    let result = runner
        .run(&scenario)
        .await
        .expect("runner returned error for object mismatch scenario");

    assert!(!result.success, "scenario should fail");
    assert_error_contains(&result, "オブジェクト要素数が一致しません");

    server.shutdown().await;
}

#[tokio::test]
async fn json_lengths_fails_for_missing_path() {
    let server = TestServer::spawn().await;
    let scenario =
        load_scenario("json_lengths_missing_path.yaml", &server.base_url);
    let runner = DefaultTestRunner::new();

    let result = runner
        .run(&scenario)
        .await
        .expect("runner returned error for missing path scenario");

    assert!(!result.success, "scenario should fail");
    assert_error_contains(&result, "がレスポンスに存在しません");

    server.shutdown().await;
}

#[tokio::test]
async fn contains_fails_when_substring_absent() {
    let server = TestServer::spawn().await;
    let scenario = load_scenario("contains_failure.yaml", &server.base_url);
    let runner = DefaultTestRunner::new();

    let result = runner
        .run(&scenario)
        .await
        .expect("runner returned error for contains failure");

    assert!(!result.success, "scenario should fail");
    assert_error_contains(&result, "レスポンスボディに期待するテキスト");

    server.shutdown().await;
}

#[tokio::test]
async fn headers_fail_when_value_differs() {
    let server = TestServer::spawn().await;
    let scenario = load_scenario("headers_failure.yaml", &server.base_url);
    let runner = DefaultTestRunner::new();

    let result = runner
        .run(&scenario)
        .await
        .expect("runner returned error for header failure");

    assert!(!result.success, "scenario should fail");
    assert_error_contains(
        &result,
        "ヘッダー 'x-test-header' の値が期待値と一致しません",
    );

    server.shutdown().await;
}

#[tokio::test]
async fn json_match_fails_when_value_differs() {
    let server = TestServer::spawn().await;
    let scenario =
        load_scenario("json_match_failure.yaml", &server.base_url);
    let runner = DefaultTestRunner::new();

    let result = runner
        .run(&scenario)
        .await
        .expect("runner returned error for json mismatch");

    assert!(!result.success, "scenario should fail");
    assert_error_contains(&result, "値が期待値と一致しません");

    server.shutdown().await;
}

#[tokio::test]
async fn status_mismatch_produces_failure() {
    let server = TestServer::spawn().await;
    let scenario = load_scenario("status_mismatch.yaml", &server.base_url);
    let runner = DefaultTestRunner::new();

    let result = runner
        .run(&scenario)
        .await
        .expect("runner returned error for status mismatch");

    assert!(!result.success, "scenario should fail");
    assert_error_contains(
        &result,
        "ステータスコードが期待値と一致しません",
    );

    server.shutdown().await;
}

// ── Markdown scenario tests ──────────────────────────

#[tokio::test]
async fn markdown_json_match_succeeds() {
    let server = TestServer::spawn().await;
    let scenario =
        load_scenario("json_match_success.scenario.md", &server.base_url);
    let runner = DefaultTestRunner::new();

    let result = runner
        .run(&scenario)
        .await
        .expect("runner returned error for markdown json match");

    assert!(
        result.success,
        "markdown scenario should succeed: {:?}",
        result.error
    );

    server.shutdown().await;
}

#[tokio::test]
async fn markdown_multi_step_succeeds() {
    let server = TestServer::spawn().await;
    let scenario =
        load_scenario("multi_step_markdown.scenario.md", &server.base_url);
    let runner = DefaultTestRunner::new();

    let result = runner
        .run(&scenario)
        .await
        .expect("runner returned error for multi-step markdown");

    assert!(
        result.success,
        "multi-step markdown scenario should succeed: {:?}",
        result.error
    );
    assert_eq!(
        result.steps.len(),
        3,
        "expected 3 steps from 3 yaml scenario blocks"
    );

    server.shutdown().await;
}

#[tokio::test]
async fn markdown_status_mismatch_produces_failure() {
    let server = TestServer::spawn().await;
    let scenario = load_scenario(
        "markdown_status_mismatch.scenario.md",
        &server.base_url,
    );
    let runner = DefaultTestRunner::new();

    let result = runner
        .run(&scenario)
        .await
        .expect("runner returned error for markdown status mismatch");

    assert!(!result.success, "markdown scenario should fail");
    assert_error_contains(
        &result,
        "ステータスコードが期待値と一致しません",
    );

    server.shutdown().await;
}

fn assert_error_contains(result: &muon::TestResult, needle: &str) {
    let step = result
        .steps
        .iter()
        .find(|step| !step.success)
        .expect("expected failing step");
    let error = step
        .error
        .as_ref()
        .expect("expected error message for failing step");
    assert!(
        error.contains(needle),
        "error message did not contain '{needle}': {error}"
    );
}
