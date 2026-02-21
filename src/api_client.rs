use crate::model::TestRunReport;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tracing::warn;

/// Response returned after submitting a test run report.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubmitResponse {
    pub run_id: String,
    pub dashboard_url: Option<String>,
}

/// Client for the Tachyon Ops scenario-reports API.
pub struct TachyonOpsClient {
    api_url: String,
    api_key: String,
    operator_id: Option<String>,
    http: reqwest::Client,
}

impl TachyonOpsClient {
    pub fn new(api_url: String, api_key: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .expect("failed to build HTTP client");
        Self {
            api_url,
            api_key,
            operator_id: None,
            http,
        }
    }

    /// Set the operator ID for multi-tenancy support.
    pub fn with_operator_id(mut self, operator_id: String) -> Self {
        self.operator_id = Some(operator_id);
        self
    }

    /// Submit a test run report to the Tachyon Ops API.
    ///
    /// Retries up to 3 times with exponential backoff on
    /// transient failures (5xx, network errors).
    pub async fn submit_report(
        &self,
        report: &TestRunReport,
    ) -> Result<SubmitResponse> {
        let url = format!(
            "{}/v1/ops/scenario-reports",
            self.api_url.trim_end_matches('/')
        );
        let max_retries = 3u32;

        for attempt in 0..=max_retries {
            let mut request = self.http.post(&url).header(
                "Authorization",
                format!("Bearer {}", self.api_key),
            );

            if let Some(ref operator_id) = self.operator_id {
                request =
                    request.header("x-operator-id", operator_id.as_str());
            }

            let result = request.json(report).send().await;

            match result {
                Ok(resp) if resp.status().is_success() => {
                    let body = resp
                        .json::<SubmitResponse>()
                        .await
                        .context("failed to parse submit response")?;
                    return Ok(body);
                }
                Ok(resp) if resp.status().is_server_error() => {
                    let status = resp.status();
                    if attempt < max_retries {
                        let delay =
                            Duration::from_millis(500 * 2u64.pow(attempt));
                        warn!(
                            status = %status,
                            attempt = attempt + 1,
                            "server error, retrying in {:?}",
                            delay
                        );
                        tokio::time::sleep(delay).await;
                        continue;
                    }
                    let body = resp.text().await.unwrap_or_default();
                    anyhow::bail!("server error after {max_retries} retries: {status} - {body}");
                }
                Ok(resp) => {
                    let status = resp.status();
                    let body = resp.text().await.unwrap_or_default();
                    anyhow::bail!("API request failed: {status} - {body}");
                }
                Err(e) => {
                    if attempt < max_retries {
                        let delay =
                            Duration::from_millis(500 * 2u64.pow(attempt));
                        warn!(
                            error = %e,
                            attempt = attempt + 1,
                            "network error, retrying in {:?}",
                            delay
                        );
                        tokio::time::sleep(delay).await;
                        continue;
                    }
                    return Err(e).context(format!(
                        "failed to submit report after {max_retries} retries"
                    ));
                }
            }
        }

        unreachable!()
    }
}
