//! TODO: add English documentation

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// TODO: add English documentation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestScenario {
    /// TODO: add English documentation
    pub name: String,
    /// TODO: add English documentation
    #[serde(default)]
    pub description: Option<String>,
    /// Tags for filtering and grouping scenarios.
    #[serde(default)]
    pub tags: Vec<String>,
    /// TODO: add English documentation
    pub steps: Vec<TestStep>,
    /// TODO: add English documentation
    #[serde(default)]
    pub vars: HashMap<String, serde_json::Value>,
    /// TODO: add English documentation
    #[serde(default)]
    pub config: TestConfig,
}

/// TODO: add English documentation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestStep {
    /// TODO: add English documentation
    pub name: String,
    /// TODO: add English documentation
    #[serde(default)]
    pub id: Option<String>,
    /// TODO: add English documentation
    #[serde(default)]
    pub description: Option<String>,
    /// TODO: add English documentation
    pub request: HttpRequest,
    /// TODO: add English documentation
    pub expect: ResponseExpectation,
    /// TODO: add English documentation
    #[serde(default)]
    pub save: HashMap<String, String>,
    /// TODO: add English documentation
    #[serde(default)]
    pub condition: Option<String>,
}

/// TODO: add English documentation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpRequest {
    /// TODO: add English documentation
    pub method: HttpMethod,
    /// TODO: add English documentation
    pub url: String,
    /// TODO: add English documentation
    #[serde(default)]
    pub headers: HashMap<String, String>,
    /// TODO: add English documentation
    #[serde(default)]
    pub query: HashMap<String, String>,
    /// TODO: add English documentation
    #[serde(default)]
    pub body: Option<serde_json::Value>,
}

/// TODO: add English documentation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum HttpMethod {
    Get,
    Post,
    Put,
    Delete,
    Patch,
    Head,
    Options,
}

/// TODO: add English documentation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResponseExpectation {
    /// TODO: add English documentation
    #[serde(default = "default_status_code")]
    pub status: u16,
    /// TODO: add English documentation
    #[serde(default)]
    pub headers: HashMap<String, String>,
    /// TODO: add English documentation
    #[serde(default)]
    pub json: HashMap<String, serde_json::Value>,
    /// TODO: add English documentation
    #[serde(default)]
    pub json_lengths: HashMap<String, usize>,
    /// TODO: add English documentation
    #[serde(default)]
    pub schema: Option<serde_json::Value>,
    /// TODO: add English documentation
    #[serde(default)]
    pub contains: Vec<String>,
    /// Full JSON equality check for REST responses.
    #[serde(default)]
    pub json_eq: Option<serde_json::Value>,
    /// Fields to exclude from `json_eq` comparison.
    #[serde(default)]
    pub json_ignore_fields: Vec<String>,
    /// SSE event stream expectations
    #[serde(default)]
    pub sse: Option<SseExpectation>,
}

/// Expectations for SSE event streams
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SseExpectation {
    /// Event types that must appear in the stream
    #[serde(default)]
    pub has_events: Vec<String>,
    /// Event types that must NOT appear in the stream
    #[serde(default)]
    pub has_no_events: Vec<String>,
    /// Ordered event assertions with data validation
    #[serde(default)]
    pub events: Vec<SseEventExpectation>,
}

/// A single SSE event assertion
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SseEventExpectation {
    /// The event type to match (e.g. "tool_call", "done")
    pub event: String,
    /// Field exact-match checks on the parsed JSON data
    #[serde(default)]
    pub data: HashMap<String, serde_json::Value>,
    /// Full JSON equality check. All non-ignored fields must match
    /// exactly; extra fields in the actual data are errors.
    #[serde(default)]
    pub data_eq: Option<serde_json::Value>,
    /// Fields to exclude from `data_eq` comparison.
    /// Supports dot-separated paths (e.g. "args.stamp_id")
    /// and wildcard `*` for array elements (e.g. "items.*.id").
    #[serde(default)]
    pub ignore_fields: Vec<String>,
    /// Substring match against the raw data text
    #[serde(default)]
    pub data_contains: Option<String>,
    /// Fields that must exist in the parsed JSON data
    #[serde(default)]
    pub data_exists: Vec<String>,
    /// Save extracted values for use in subsequent assertions
    #[serde(default)]
    pub save: HashMap<String, String>,
}

/// TODO: add English documentation
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TestConfig {
    /// TODO: add English documentation
    #[serde(default)]
    pub base_url: Option<String>,
    /// TODO: add English documentation
    #[serde(default)]
    pub headers: HashMap<String, String>,
    /// TODO: add English documentation
    #[serde(default = "default_timeout")]
    pub timeout: u64,
    /// TODO: add English documentation
    #[serde(default)]
    pub continue_on_failure: bool,
}

/// TODO: add English documentation
fn default_status_code() -> u16 {
    200
}

/// TODO: add English documentation
fn default_timeout() -> u64 {
    30
}

impl TestScenario {
    /// Deserialize a scenario from a YAML string.
    pub fn from_yaml(yaml: &str) -> Result<Self, serde_yaml::Error> {
        serde_yaml::from_str(yaml)
    }

    /// Serialize the scenario to a YAML string.
    pub fn to_yaml(&self) -> Result<String, serde_yaml::Error> {
        serde_yaml::to_string(self)
    }

    /// Parse a scenario from a Markdown (`.scenario.md`) string.
    ///
    /// The file must contain YAML front matter (`---`) with at
    /// least a `name` field, and one or more ` ```yaml scenario `
    /// fenced code blocks that define `steps`.
    pub fn from_markdown(md: &str) -> Result<Self, anyhow::Error> {
        crate::markdown_parser::parse_markdown_scenario(md)
    }
}

/// Result of running a single test scenario.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestResult {
    pub name: String,
    pub success: bool,
    pub error: Option<String>,
    pub steps: Vec<StepResult>,
    pub duration_ms: u64,
}

/// Result of running a single step within a scenario.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepResult {
    pub name: String,
    pub success: bool,
    pub error: Option<String>,
    pub request: RequestInfo,
    pub response: Option<ResponseInfo>,
    pub duration_ms: u64,
}

/// Captured HTTP request information for a step.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestInfo {
    pub method: String,
    pub url: String,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
}

/// Captured HTTP response information for a step.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResponseInfo {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
}

/// Full report payload sent to Tachyon Ops API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestRunReport {
    pub scenarios: Vec<TestResult>,
    pub total_duration_ms: u64,
    pub timestamp: String,
    pub ci: Option<CiMetadata>,
}

/// CI environment metadata attached to a test run report.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CiMetadata {
    pub provider: String,
    pub repository: String,
    pub branch: String,
    pub commit_sha: String,
    pub pr_number: Option<u64>,
    pub run_id: Option<String>,
    pub run_url: Option<String>,
}
