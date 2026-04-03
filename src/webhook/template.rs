//! Notification payload templates for Slack, Discord, and
//! generic webhooks.

use crate::model::{CiMetadata, TestResult};
use crate::webhook::WebhookType;
use serde_json::{json, Value};

/// Build a webhook payload formatted for the given webhook
/// type.
pub fn build_payload(
    webhook_type: &WebhookType,
    results: &[TestResult],
    ci: Option<&CiMetadata>,
) -> Value {
    match webhook_type {
        WebhookType::Slack => build_slack_payload(results, ci),
        WebhookType::Discord => build_discord_payload(results, ci),
        WebhookType::Generic => build_generic_payload(results, ci),
    }
}

/// Build a Slack Block Kit payload.
fn build_slack_payload(
    results: &[TestResult],
    ci: Option<&CiMetadata>,
) -> Value {
    let (passed, failed, total, total_duration) = summarize(results);
    let all_pass = failed == 0;

    let emoji = if all_pass {
        ":white_check_mark:"
    } else {
        ":x:"
    };
    let status_text = if all_pass {
        "All tests passed"
    } else {
        "Tests failed"
    };

    let header_text =
        format!("{emoji} {status_text} ({passed}/{total} passed)");

    let mut blocks: Vec<Value> = vec![
        json!({
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": header_text,
                "emoji": true
            }
        }),
        json!({
            "type": "section",
            "fields": [
                {
                    "type": "mrkdwn",
                    "text": format!(
                        "*Passed:* {passed}\n*Failed:* {failed}\n*Total:* {total}"
                    )
                },
                {
                    "type": "mrkdwn",
                    "text": format!("*Duration:* {total_duration} ms")
                }
            ]
        }),
    ];

    // Failed scenario details
    let failed_scenarios: Vec<&TestResult> =
        results.iter().filter(|r| !r.success).collect();
    if !failed_scenarios.is_empty() {
        let mut details = String::from("*Failed scenarios:*\n");
        for r in &failed_scenarios {
            details.push_str(&format!(
                "• `{}` ({} ms)\n",
                r.name, r.duration_ms
            ));
            for step in &r.steps {
                if !step.success {
                    if let Some(err) = &step.error {
                        let truncated = truncate(err, 100);
                        details.push_str(&format!(
                            "  └ {} — {}\n",
                            step.name, truncated
                        ));
                    }
                }
            }
        }
        blocks.push(json!({
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": details
            }
        }));
    }

    // CI metadata context
    if let Some(ci) = ci {
        let mut elements: Vec<Value> = vec![json!({
            "type": "mrkdwn",
            "text": format!(
                "*{}* | `{}` | `{}`",
                ci.repository,
                ci.branch,
                &ci.commit_sha[..7.min(ci.commit_sha.len())]
            )
        })];
        if let Some(url) = &ci.run_url {
            elements.push(json!({
                "type": "mrkdwn",
                "text": format!("<{url}|View run>")
            }));
        }
        blocks.push(json!({
            "type": "context",
            "elements": elements
        }));
    }

    json!({ "blocks": blocks })
}

/// Build a Discord embed payload.
fn build_discord_payload(
    results: &[TestResult],
    ci: Option<&CiMetadata>,
) -> Value {
    let (passed, failed, total, total_duration) = summarize(results);
    let all_pass = failed == 0;

    let color = if all_pass { 0x2ECC71 } else { 0xE74C3C };
    let status_text = if all_pass {
        "All tests passed"
    } else {
        "Tests failed"
    };
    let emoji = if all_pass { "✅" } else { "❌" };

    let title = format!("{emoji} {status_text} ({passed}/{total} passed)");

    let mut fields = vec![
        json!({
            "name": "Passed",
            "value": passed.to_string(),
            "inline": true
        }),
        json!({
            "name": "Failed",
            "value": failed.to_string(),
            "inline": true
        }),
        json!({
            "name": "Duration",
            "value": format!("{total_duration} ms"),
            "inline": true
        }),
    ];

    // Failed scenario details
    let failed_scenarios: Vec<&TestResult> =
        results.iter().filter(|r| !r.success).collect();
    if !failed_scenarios.is_empty() {
        let mut details = String::new();
        for r in &failed_scenarios {
            details.push_str(&format!(
                "**{}** ({} ms)\n",
                r.name, r.duration_ms
            ));
            for step in &r.steps {
                if !step.success {
                    if let Some(err) = &step.error {
                        let truncated = truncate(err, 100);
                        details.push_str(&format!(
                            "└ {} — {}\n",
                            step.name, truncated
                        ));
                    }
                }
            }
        }
        fields.push(json!({
            "name": "Failed Scenarios",
            "value": truncate(&details, 1024),
            "inline": false
        }));
    }

    let mut embed = json!({
        "title": title,
        "color": color,
        "fields": fields,
        "footer": { "text": "muon scenario runner" }
    });

    if let Some(ci) = ci {
        embed["description"] = json!(format!(
            "{} | `{}` | `{}`",
            ci.repository,
            ci.branch,
            &ci.commit_sha[..7.min(ci.commit_sha.len())]
        ));
        if let Some(url) = &ci.run_url {
            embed["url"] = json!(url);
        }
    }

    json!({ "embeds": [embed] })
}

/// Build a generic JSON payload.
fn build_generic_payload(
    results: &[TestResult],
    ci: Option<&CiMetadata>,
) -> Value {
    let (passed, failed, total, total_duration) = summarize(results);

    let failed_details: Vec<Value> = results
        .iter()
        .filter(|r| !r.success)
        .map(|r| {
            let failed_steps: Vec<Value> = r
                .steps
                .iter()
                .filter(|s| !s.success)
                .map(|s| {
                    json!({
                        "name": s.name,
                        "error": s.error,
                        "duration_ms": s.duration_ms
                    })
                })
                .collect();
            json!({
                "name": r.name,
                "duration_ms": r.duration_ms,
                "error": r.error,
                "failed_steps": failed_steps
            })
        })
        .collect();

    let mut payload = json!({
        "event": "test_run_completed",
        "success": failed == 0,
        "summary": {
            "total": total,
            "passed": passed,
            "failed": failed,
            "duration_ms": total_duration
        },
        "failed_scenarios": failed_details,
    });

    if let Some(ci) = ci {
        payload["ci"] = json!(ci);
    }

    payload
}

/// Compute summary statistics from test results.
fn summarize(results: &[TestResult]) -> (usize, usize, usize, u64) {
    let total = results.len();
    let passed = results.iter().filter(|r| r.success).count();
    let failed = total - passed;
    let total_duration: u64 = results.iter().map(|r| r.duration_ms).sum();
    (passed, failed, total, total_duration)
}

/// Truncate a string to `max_len` characters, appending
/// "..." if truncated.
fn truncate(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}...", &s[..max_len])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{RequestInfo, StepResult};

    fn make_results(success: bool) -> Vec<TestResult> {
        vec![TestResult {
            name: "test-scenario".to_string(),
            success,
            error: if success {
                None
            } else {
                Some("assertion failed".to_string())
            },
            steps: vec![StepResult {
                name: "step-1".to_string(),
                success,
                error: if success {
                    None
                } else {
                    Some("status mismatch".to_string())
                },
                request: RequestInfo {
                    method: "GET".to_string(),
                    url: "http://example.com/api".to_string(),
                    headers: Default::default(),
                    body: None,
                },
                response: None,
                duration_ms: 150,
            }],
            duration_ms: 200,
        }]
    }

    #[test]
    fn test_slack_payload_failure() {
        let results = make_results(false);
        let payload = build_slack_payload(&results, None);
        let blocks = payload["blocks"].as_array().unwrap();
        assert!(blocks.len() >= 2);
        let header = blocks[0]["text"]["text"].as_str().unwrap();
        assert!(header.contains("Tests failed"));
        assert!(header.contains("0/1 passed"));
    }

    #[test]
    fn test_slack_payload_success() {
        let results = make_results(true);
        let payload = build_slack_payload(&results, None);
        let header = payload["blocks"][0]["text"]["text"].as_str().unwrap();
        assert!(header.contains("All tests passed"));
    }

    #[test]
    fn test_discord_payload_failure() {
        let results = make_results(false);
        let payload = build_discord_payload(&results, None);
        let embed = &payload["embeds"][0];
        assert_eq!(embed["color"], 0xE74C3C);
        let title = embed["title"].as_str().unwrap();
        assert!(title.contains("Tests failed"));
    }

    #[test]
    fn test_discord_payload_success() {
        let results = make_results(true);
        let payload = build_discord_payload(&results, None);
        let embed = &payload["embeds"][0];
        assert_eq!(embed["color"], 0x2ECC71);
    }

    #[test]
    fn test_generic_payload() {
        let results = make_results(false);
        let payload = build_generic_payload(&results, None);
        assert_eq!(payload["event"], "test_run_completed");
        assert_eq!(payload["success"], false);
        assert_eq!(payload["summary"]["failed"], 1);
        assert_eq!(
            payload["failed_scenarios"].as_array().unwrap().len(),
            1
        );
    }

    #[test]
    fn test_generic_payload_with_ci() {
        let results = make_results(false);
        let ci = CiMetadata {
            provider: "github".to_string(),
            repository: "org/repo".to_string(),
            branch: "main".to_string(),
            commit_sha: "abc1234def".to_string(),
            pr_number: Some(42),
            run_id: Some("999".to_string()),
            run_url: Some(
                "https://github.com/org/repo/actions/runs/999".to_string(),
            ),
        };
        let payload = build_generic_payload(&results, Some(&ci));
        assert_eq!(payload["ci"]["provider"], "github");
        assert_eq!(payload["ci"]["pr_number"], 42);
    }

    #[test]
    fn test_truncate() {
        assert_eq!(truncate("short", 10), "short");
        assert_eq!(truncate("hello world", 5), "hello...");
    }

    #[test]
    fn test_build_payload_dispatch() {
        let results = make_results(false);
        let slack = build_payload(&WebhookType::Slack, &results, None);
        assert!(slack.get("blocks").is_some());

        let discord = build_payload(&WebhookType::Discord, &results, None);
        assert!(discord.get("embeds").is_some());

        let generic = build_payload(&WebhookType::Generic, &results, None);
        assert!(generic.get("event").is_some());
    }
}
