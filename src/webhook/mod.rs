//! Webhook notification module for sending test results to
//! external services (Slack, Discord, generic HTTP).

pub mod template;

use anyhow::{Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tracing::{debug, error, info, warn};

/// Type of webhook destination.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum WebhookType {
    /// Slack Incoming Webhook.
    Slack,
    /// Discord Webhook.
    Discord,
    /// Generic HTTP POST endpoint.
    Generic,
}

/// When to trigger webhook notifications.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum NotifyOn {
    /// Notify only on test failure (default).
    #[default]
    Failure,
    /// Notify only on success.
    Success,
    /// Notify on both success and failure.
    Always,
}

/// Configuration for a single webhook endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookConfig {
    /// Webhook destination URL.
    pub url: String,
    /// Type of webhook (determines payload format).
    #[serde(default = "default_webhook_type")]
    pub webhook_type: WebhookType,
    /// When to send the notification.
    #[serde(default)]
    pub notify_on: NotifyOn,
    /// Optional display name for the webhook source.
    #[serde(default)]
    pub name: Option<String>,
    /// Custom headers to include in the webhook request.
    #[serde(default)]
    pub headers: std::collections::HashMap<String, String>,
    /// Maximum number of retry attempts on failure.
    #[serde(default = "default_max_retries")]
    pub max_retries: u32,
    /// Base retry interval in milliseconds.
    #[serde(default = "default_retry_interval_ms")]
    pub retry_interval_ms: u64,
}

fn default_webhook_type() -> WebhookType {
    WebhookType::Generic
}

fn default_max_retries() -> u32 {
    3
}

fn default_retry_interval_ms() -> u64 {
    1000
}

/// Result of a webhook delivery attempt.
#[derive(Debug, Clone, Serialize)]
pub struct WebhookDeliveryResult {
    /// The webhook URL (redacted for security).
    pub url_redacted: String,
    /// Whether delivery succeeded.
    pub success: bool,
    /// HTTP status code if a response was received.
    pub status_code: Option<u16>,
    /// Error message if delivery failed.
    pub error: Option<String>,
    /// Number of attempts made.
    pub attempts: u32,
}

/// Sends webhook notifications for test results.
pub struct WebhookSender {
    client: Client,
}

impl WebhookSender {
    /// Create a new webhook sender.
    pub fn new() -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .expect("failed to build HTTP client");
        Self { client }
    }

    /// Send a notification to a single webhook endpoint.
    pub async fn send(
        &self,
        config: &WebhookConfig,
        payload: &serde_json::Value,
    ) -> WebhookDeliveryResult {
        let url_redacted = redact_url(&config.url);
        let max_attempts = config.max_retries + 1;

        for attempt in 1..=max_attempts {
            debug!(
                "Webhook delivery attempt {}/{} to {}",
                attempt, max_attempts, url_redacted
            );

            let mut request = self
                .client
                .post(&config.url)
                .header("Content-Type", "application/json");

            for (key, value) in &config.headers {
                request = request.header(key, value);
            }

            match request.json(payload).send().await {
                Ok(resp) => {
                    let status = resp.status().as_u16();
                    if resp.status().is_success() {
                        info!(
                            "Webhook delivered to {} (status {})",
                            url_redacted, status
                        );
                        return WebhookDeliveryResult {
                            url_redacted,
                            success: true,
                            status_code: Some(status),
                            error: None,
                            attempts: attempt,
                        };
                    }

                    let body = resp.text().await.unwrap_or_default();

                    if status >= 500 && attempt < max_attempts {
                        let delay = Duration::from_millis(
                            config.retry_interval_ms
                                * 2u64.pow(attempt - 1),
                        );
                        warn!(
                            "Webhook server error {} from {}, \
                             retrying in {:?}",
                            status, url_redacted, delay
                        );
                        tokio::time::sleep(delay).await;
                        continue;
                    }

                    error!(
                        "Webhook delivery failed to {} \
                         (status {}): {}",
                        url_redacted, status, body
                    );
                    return WebhookDeliveryResult {
                        url_redacted,
                        success: false,
                        status_code: Some(status),
                        error: Some(format!("HTTP {status}: {body}")),
                        attempts: attempt,
                    };
                }
                Err(e) => {
                    if attempt < max_attempts {
                        let delay = Duration::from_millis(
                            config.retry_interval_ms
                                * 2u64.pow(attempt - 1),
                        );
                        warn!(
                            "Webhook network error to {}: {}, \
                             retrying in {:?}",
                            url_redacted, e, delay
                        );
                        tokio::time::sleep(delay).await;
                        continue;
                    }

                    error!(
                        "Webhook delivery failed to {}: {}",
                        url_redacted, e
                    );
                    return WebhookDeliveryResult {
                        url_redacted,
                        success: false,
                        status_code: None,
                        error: Some(format!("Network error: {e}")),
                        attempts: attempt,
                    };
                }
            }
        }

        unreachable!()
    }

    /// Send notifications to all configured webhooks for a
    /// test run. Only sends when the `notify_on` condition
    /// matches.
    pub async fn send_all(
        &self,
        configs: &[WebhookConfig],
        results: &[crate::model::TestResult],
        ci: Option<&crate::model::CiMetadata>,
    ) -> Vec<WebhookDeliveryResult> {
        let has_failure = results.iter().any(|r| !r.success);
        let all_success = !has_failure;

        let mut delivery_results = Vec::new();

        for config in configs {
            let should_notify = match config.notify_on {
                NotifyOn::Failure => has_failure,
                NotifyOn::Success => all_success,
                NotifyOn::Always => true,
            };

            if !should_notify {
                debug!(
                    "Skipping webhook {} (notify_on={:?}, \
                     has_failure={})",
                    redact_url(&config.url),
                    config.notify_on,
                    has_failure
                );
                continue;
            }

            let payload =
                template::build_payload(&config.webhook_type, results, ci);

            let result = self.send(config, &payload).await;
            delivery_results.push(result);
        }

        delivery_results
    }
}

impl Default for WebhookSender {
    fn default() -> Self {
        Self::new()
    }
}

/// Redact the URL path/query for log output, keeping only
/// the host.
fn redact_url(url: &str) -> String {
    match reqwest::Url::parse(url) {
        Ok(parsed) => {
            format!(
                "{}://{}/<redacted>",
                parsed.scheme(),
                parsed.host_str().unwrap_or("unknown")
            )
        }
        Err(_) => "<invalid-url>".to_string(),
    }
}

/// Load webhook configurations from a YAML file.
///
/// The file should contain either a single `WebhookConfig`
/// or a list of them.
pub fn load_webhook_configs(
    path: &std::path::Path,
) -> Result<Vec<WebhookConfig>> {
    let content = std::fs::read_to_string(path).context(format!(
        "Failed to read webhook config: {}",
        path.display()
    ))?;

    // Try parsing as a list first, then as a single config
    if let Ok(configs) =
        serde_yaml::from_str::<Vec<WebhookConfig>>(&content)
    {
        return Ok(configs);
    }

    let config = serde_yaml::from_str::<WebhookConfig>(&content)
        .context("Failed to parse webhook config as YAML")?;
    Ok(vec![config])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_redact_url() {
        assert_eq!(
            redact_url("https://hooks.slack.com/services/T00/B00/xxx"),
            "https://hooks.slack.com/<redacted>"
        );
        assert_eq!(
            redact_url("https://discord.com/api/webhooks/123/abc"),
            "https://discord.com/<redacted>"
        );
        assert_eq!(redact_url("not-a-url"), "<invalid-url>");
    }

    #[test]
    fn test_webhook_config_deserialize() {
        let yaml = r#"
url: https://hooks.slack.com/services/T00/B00/xxx
webhook_type: slack
notify_on: failure
max_retries: 2
"#;
        let config: WebhookConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(config.webhook_type, WebhookType::Slack);
        assert_eq!(config.notify_on, NotifyOn::Failure);
        assert_eq!(config.max_retries, 2);
    }

    #[test]
    fn test_webhook_config_defaults() {
        let yaml = r#"
url: https://example.com/webhook
"#;
        let config: WebhookConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(config.webhook_type, WebhookType::Generic);
        assert_eq!(config.notify_on, NotifyOn::Failure);
        assert_eq!(config.max_retries, 3);
        assert_eq!(config.retry_interval_ms, 1000);
    }

    #[test]
    fn test_load_webhook_configs_list() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("webhooks.yaml");
        std::fs::write(
            &path,
            r#"
- url: https://hooks.slack.com/services/T00/B00/xxx
  webhook_type: slack
- url: https://discord.com/api/webhooks/123/abc
  webhook_type: discord
"#,
        )
        .unwrap();

        let configs = load_webhook_configs(&path).unwrap();
        assert_eq!(configs.len(), 2);
        assert_eq!(configs[0].webhook_type, WebhookType::Slack);
        assert_eq!(configs[1].webhook_type, WebhookType::Discord);
    }
}
