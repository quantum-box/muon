//! Post-deploy hook endpoint and GitHub Check Run
//! integration.
//!
//! Receives deploy-complete webhooks, runs configured
//! scenarios against the deployed URL, and reports results
//! as a GitHub Check Run.

use crate::metrics::collector::{
    InMemoryMetricsCollector, MetricsCollector,
};
use crate::model::{TestResult, TestScenario};
use crate::runner::{DefaultTestRunner, TestRunner};
use crate::server::state::{AppState, RunRecord, RunStatus};
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::post;
use axum::{Json, Router};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tracing::{error, info, warn};

/// Build the hooks sub-router.
pub fn hooks_routes() -> Router<Arc<AppState>> {
    Router::new().route("/hooks/deploy-complete", post(deploy_complete))
}

// ── tachyon.yaml config types ──────────────────────────

/// Top-level tachyon.yaml configuration.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TachyonConfig {
    /// `spec` section (e.g. D1 database declarations).
    pub spec: Option<TachyonConfigSpec>,
    /// Post-deploy hook configuration.
    pub post_deploy: Option<PostDeployConfig>,
}

/// `spec` section of tachyon.yaml.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TachyonConfigSpec {
    /// D1 database bindings declared for this app.
    pub d1_databases: Vec<D1DatabaseDeclaration>,
}

/// A single D1 database binding declared in tachyon.yaml.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct D1DatabaseDeclaration {
    /// Binding name used in the worker (e.g. `DB`).
    pub binding: String,
    /// Human-readable name for the D1 database.
    pub database_name: String,
    /// Directory containing `.sql` migration files,
    /// relative to the project root.
    #[serde(default)]
    pub migrations_dir: Option<String>,
}

/// Post-deploy hook configuration from tachyon.yaml.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostDeployConfig {
    /// Scenario files to run after deploy.
    #[serde(default)]
    pub scenarios: Vec<PostDeployScenario>,
    /// Action to take when scenarios fail.
    #[serde(default)]
    pub on_failure: OnFailureAction,
}

/// A single scenario entry in the postDeploy config.
#[derive(Debug, Clone, Deserialize)]
pub struct PostDeployScenario {
    /// Path to the scenario file or directory.
    pub path: String,
    /// Optional name filter (partial match).
    #[serde(default)]
    pub filter: Option<String>,
    /// Optional timeout override per step (seconds).
    #[serde(default)]
    pub timeout: Option<u64>,
}

/// Action to take when post-deploy scenarios fail.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum OnFailureAction {
    /// Send a notification (default).
    #[default]
    Notify,
    /// Trigger a rollback of the deployment.
    Rollback,
}

// ── Webhook payload & response ─────────────────────────

/// A resolved D1 database binding supplied in the webhook.
///
/// The build system resolves the UUID after provisioning
/// and passes it here so muon can run migrations.
#[derive(Debug, Deserialize, Clone)]
pub struct D1BindingInfo {
    /// Binding name (matches `spec.d1Databases[].binding`).
    pub binding_name: String,
    /// Cloudflare D1 database UUID.
    pub database_id: String,
}

/// Payload sent by the deploy system when a deployment
/// completes.
#[derive(Debug, Deserialize)]
pub struct DeployCompletePayload {
    /// URL of the deployed preview environment.
    pub deploy_url: String,
    /// Deployment environment name (e.g. "preview",
    /// "staging").
    #[serde(default = "default_environment")]
    pub environment: String,
    /// Git commit SHA of the deployed code.
    pub commit_sha: String,
    /// GitHub repository in "owner/repo" format.
    pub repository: String,
    /// Git ref (e.g. "refs/heads/feature/foo").
    #[serde(default)]
    pub git_ref: Option<String>,
    /// Pull request number, if applicable.
    #[serde(default)]
    pub pr_number: Option<u64>,
    /// Path to tachyon.yaml (relative to scenario dir).
    /// Falls back to "tachyon.yaml" in the project root.
    #[serde(default)]
    pub config_path: Option<String>,
    /// GitHub token for creating Check Runs.
    #[serde(default)]
    pub github_token: Option<String>,
    /// Resolved D1 bindings (binding name → database UUID).
    /// Required for post-deploy migration execution.
    #[serde(default)]
    pub d1_bindings: Vec<D1BindingInfo>,
    /// Cloudflare account ID for D1 API calls.
    #[serde(default)]
    pub cloudflare_account_id: Option<String>,
    /// Cloudflare API token for D1 API calls.
    #[serde(default)]
    pub cloudflare_api_token: Option<String>,
}

fn default_environment() -> String {
    "preview".to_string()
}

/// Response returned from the deploy-complete endpoint.
#[derive(Debug, Serialize)]
pub struct DeployCompleteResponse {
    /// Unique identifier for this hook execution.
    pub hook_run_id: String,
    /// Overall success status.
    pub success: bool,
    /// Number of scenarios executed.
    pub scenarios_run: usize,
    /// Number of scenarios that passed.
    pub scenarios_passed: usize,
    /// Number of scenarios that failed.
    pub scenarios_failed: usize,
    /// Action taken on failure (if any).
    pub on_failure: OnFailureAction,
    /// Whether a rollback was triggered.
    pub rollback_triggered: bool,
    /// GitHub Check Run URL (if created).
    pub check_run_url: Option<String>,
    /// Individual scenario results.
    pub results: Vec<ScenarioResultSummary>,
    /// Number of D1 SQL migrations applied.
    pub d1_migrations_applied: usize,
}

/// Summary of a single scenario execution within the hook.
#[derive(Debug, Serialize)]
pub struct ScenarioResultSummary {
    pub name: String,
    pub success: bool,
    pub duration_ms: u64,
    pub steps_total: usize,
    pub steps_passed: usize,
    pub error: Option<String>,
}

// ── Handler ────────────────────────────────────────────

/// `POST /api/hooks/deploy-complete`
///
/// Receives a deploy-complete webhook and:
/// 1. Runs `postDeploy.scenarios` against the deploy URL.
/// 2. Applies `spec.d1Databases` SQL migrations when CF
///    credentials and binding UUIDs are in the payload.
///
/// Returns 200 with a JSON body summarising outcomes.
/// Returns 422 when neither scenarios nor D1 migrations
/// are configured.
async fn deploy_complete(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<DeployCompletePayload>,
) -> Result<impl IntoResponse, StatusCode> {
    let hook_run_id = uuid::Uuid::new_v4().to_string();
    info!(
        hook_run_id = %hook_run_id,
        deploy_url = %payload.deploy_url,
        environment = %payload.environment,
        commit_sha = %payload.commit_sha,
        "Received deploy-complete webhook"
    );

    // 1. Load tachyon.yaml config
    let config =
        load_tachyon_config(&state, payload.config_path.as_deref())
            .map_err(|e| {
                error!("Failed to load tachyon.yaml: {}", e);
                StatusCode::BAD_REQUEST
            })?;

    let post_deploy = config.post_deploy;
    let d1_databases =
        config.spec.map(|s| s.d1_databases).unwrap_or_default();

    let has_scenarios = post_deploy
        .as_ref()
        .map(|pd| !pd.scenarios.is_empty())
        .unwrap_or(false);

    // D1 migrations need CF credentials + declarations in yaml
    let has_d1_work = !payload.d1_bindings.is_empty()
        && payload.cloudflare_account_id.is_some()
        && payload.cloudflare_api_token.is_some()
        && d1_databases.iter().any(|d| d.migrations_dir.is_some());

    if !has_scenarios && !has_d1_work {
        warn!(
            hook_run_id = %hook_run_id,
            "Nothing to do: no scenarios and no \
             D1 migrations configured"
        );
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }

    // 2. Load and run scenarios
    let runner = DefaultTestRunner::new();
    let mut results: Vec<TestResult> = Vec::new();

    if let Some(ref pd) = post_deploy {
        if pd.scenarios.is_empty() {
            warn!(
                hook_run_id = %hook_run_id,
                "No scenarios in postDeploy config"
            );
        }

        for scenario_config in &pd.scenarios {
            let scenario_path =
                resolve_scenario_path(&state, &scenario_config.path);

            let loaded = load_scenarios_from_path(
                &state,
                &scenario_path,
                scenario_config.filter.as_deref(),
            );

            for mut scenario in loaded {
                // Override base_url with deploy URL
                scenario.config.base_url = Some(payload.deploy_url.clone());

                if let Some(timeout) = scenario_config.timeout {
                    scenario.config.timeout = timeout;
                }

                info!(
                    scenario = %scenario.name,
                    base_url = %payload.deploy_url,
                    "Running post-deploy scenario"
                );

                // Record as a run in state
                let run_id = uuid::Uuid::new_v4().to_string();
                let run_record = RunRecord {
                    id: run_id.clone(),
                    scenario_id: format!("hook-{hook_run_id}"),
                    scenario_name: scenario.name.clone(),
                    result: None,
                    started_at: Utc::now(),
                    status: RunStatus::Running,
                };
                state.runs.write().await.insert(run_id.clone(), run_record);

                let result = runner.run(&scenario).await;

                let mut runs = state.runs.write().await;
                if let Some(record) = runs.get_mut(&run_id) {
                    match &result {
                        Ok(r) => {
                            record.status = if r.success {
                                RunStatus::Completed
                            } else {
                                RunStatus::Failed
                            };

                            let collector = InMemoryMetricsCollector::new(
                                state.metrics_store.clone(),
                            );
                            collector
                                .record(&run_id, &scenario.name, r)
                                .await;

                            record.result = Some(r.clone());
                        }
                        Err(e) => {
                            error!(
                                "Scenario {} failed: {}",
                                scenario.name, e
                            );
                            record.status = RunStatus::Failed;
                        }
                    }
                }
                drop(runs);

                match result {
                    Ok(r) => results.push(r),
                    Err(e) => {
                        results.push(TestResult {
                            name: scenario.name.clone(),
                            success: false,
                            error: Some(e.to_string()),
                            steps: vec![],
                            duration_ms: 0,
                        });
                    }
                }
            }
        }
    }

    // 3. Summarize scenario results
    let scenarios_run = results.len();
    let scenarios_passed = results.iter().filter(|r| r.success).count();
    let scenarios_failed = scenarios_run - scenarios_passed;
    let all_passed = scenarios_failed == 0;

    let result_summaries: Vec<ScenarioResultSummary> = results
        .iter()
        .map(|r| {
            let steps_passed = r.steps.iter().filter(|s| s.success).count();
            ScenarioResultSummary {
                name: r.name.clone(),
                success: r.success,
                duration_ms: r.duration_ms,
                steps_total: r.steps.len(),
                steps_passed,
                error: r.error.clone(),
            }
        })
        .collect();

    // 4. Create GitHub Check Run if token is provided
    let check_run_url = if let Some(ref token) = payload.github_token {
        match create_github_check_run(
            token,
            &payload.repository,
            &payload.commit_sha,
            &payload.deploy_url,
            &results,
        )
        .await
        {
            Ok(url) => Some(url),
            Err(e) => {
                error!("Failed to create GitHub Check Run: {}", e);
                None
            }
        }
    } else {
        None
    };

    // 5. Handle failure action
    let mut rollback_triggered = false;
    if !all_passed {
        if let Some(ref pd) = post_deploy {
            match pd.on_failure {
                OnFailureAction::Rollback => {
                    info!(
                        hook_run_id = %hook_run_id,
                        "Triggering rollback due to \
                         failed scenarios"
                    );
                    rollback_triggered = true;
                    // Caller inspects the response and
                    // triggers the actual rollback.
                }
                OnFailureAction::Notify => {
                    info!(
                        hook_run_id = %hook_run_id,
                        failed = scenarios_failed,
                        "Post-deploy scenarios failed; \
                         notification requested"
                    );
                }
            }
        }
    }

    // 6. Apply D1 migrations
    let mut d1_migrations_applied = 0usize;
    if let (Some(ref account_id), Some(ref api_token)) = (
        &payload.cloudflare_account_id,
        &payload.cloudflare_api_token,
    ) {
        for decl in &d1_databases {
            let Some(ref migrations_dir_str) = decl.migrations_dir else {
                continue;
            };

            let Some(binding_info) = payload
                .d1_bindings
                .iter()
                .find(|b| b.binding_name == decl.binding)
            else {
                warn!(
                    binding = %decl.binding,
                    "No database_id for D1 binding in payload; \
                     skipping migrations"
                );
                continue;
            };

            let dir = resolve_migrations_dir(&state, migrations_dir_str);
            if !dir.is_dir() {
                warn!(
                    binding = %decl.binding,
                    dir = %dir.display(),
                    "Migrations directory not found; \
                     skipping"
                );
                continue;
            }

            match apply_d1_migrations_for_database(
                account_id,
                api_token,
                &binding_info.database_id,
                &dir,
            )
            .await
            {
                Ok(n) => {
                    d1_migrations_applied += n;
                    info!(
                        binding = %decl.binding,
                        database_id = %binding_info.database_id,
                        applied = n,
                        "D1 migrations applied"
                    );
                }
                Err(e) => {
                    error!(
                        binding = %decl.binding,
                        database_id = %binding_info.database_id,
                        error = %e,
                        "Failed to apply D1 migrations"
                    );
                }
            }
        }
    }

    let on_failure =
        post_deploy.map(|pd| pd.on_failure).unwrap_or_default();

    let response = DeployCompleteResponse {
        hook_run_id,
        success: all_passed,
        scenarios_run,
        scenarios_passed,
        scenarios_failed,
        on_failure,
        rollback_triggered,
        check_run_url,
        results: result_summaries,
        d1_migrations_applied,
    };

    // Always 200; `success` in the body indicates pass/fail.
    Ok((StatusCode::OK, Json(response)))
}

// ── D1 migration helpers ───────────────────────────────

/// Execute a single SQL statement against a Cloudflare D1
/// database and return the parsed JSON response.
async fn execute_d1_query(
    account_id: &str,
    api_token: &str,
    database_id: &str,
    sql: &str,
) -> anyhow::Result<serde_json::Value> {
    let client = reqwest::Client::new();
    let url = format!(
        "https://api.cloudflare.com/client/v4/\
         accounts/{account_id}/d1/database/\
         {database_id}/query"
    );
    let body = serde_json::json!({ "sql": sql, "params": [] });

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {api_token}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        anyhow::bail!("Cloudflare D1 API error {}: {}", status, text);
    }

    let json: serde_json::Value = resp.json().await?;
    Ok(json)
}

/// Read all `.sql` files from `dir`, sorted by filename.
///
/// Returns a list of `(filename, sql_content)` pairs.
fn load_migration_files(
    dir: &std::path::Path,
) -> anyhow::Result<Vec<(String, String)>> {
    let mut files = Vec::new();

    for entry in std::fs::read_dir(dir)?.flatten() {
        let path = entry.path();
        if path.is_file() && path.extension().is_some_and(|e| e == "sql") {
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            let content = std::fs::read_to_string(&path)?;
            files.push((name, content));
        }
    }

    files.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(files)
}

/// Apply pending SQL migrations from `dir` to the given
/// D1 database.
///
/// Creates a `d1_migrations` tracking table on first run,
/// then applies any `.sql` files that have not yet been
/// recorded there.
///
/// Returns the number of newly-applied migrations.
async fn apply_d1_migrations_for_database(
    account_id: &str,
    api_token: &str,
    database_id: &str,
    dir: &std::path::Path,
) -> anyhow::Result<usize> {
    // Ensure the migration tracking table exists.
    execute_d1_query(
        account_id,
        api_token,
        database_id,
        "CREATE TABLE IF NOT EXISTS d1_migrations (\
            id INTEGER PRIMARY KEY AUTOINCREMENT, \
            name TEXT NOT NULL UNIQUE, \
            applied_at TEXT NOT NULL \
            DEFAULT (datetime('now')))",
    )
    .await?;

    // Fetch already-applied migration names.
    let result = execute_d1_query(
        account_id,
        api_token,
        database_id,
        "SELECT name FROM d1_migrations ORDER BY name",
    )
    .await?;

    let applied: std::collections::HashSet<String> = result["result"][0]
        ["results"]
        .as_array()
        .map(|rows| {
            rows.iter()
                .filter_map(|r| r["name"].as_str())
                .map(|s| s.to_string())
                .collect()
        })
        .unwrap_or_default();

    let migrations = load_migration_files(dir)?;
    let mut applied_count = 0usize;

    for (name, sql) in &migrations {
        if applied.contains(name) {
            continue;
        }

        info!(migration = %name, "Applying D1 migration");

        execute_d1_query(account_id, api_token, database_id, sql).await?;

        // Escape single quotes to prevent SQL injection.
        let safe_name = name.replace('\'', "''");
        execute_d1_query(
            account_id,
            api_token,
            database_id,
            &format!(
                "INSERT INTO d1_migrations (name) \
                 VALUES ('{safe_name}')"
            ),
        )
        .await?;

        applied_count += 1;
    }

    Ok(applied_count)
}

/// Resolve a migrations directory relative to the project
/// root (parent of `scenario_dir`).
fn resolve_migrations_dir(
    state: &AppState,
    dir: &str,
) -> std::path::PathBuf {
    let candidate = std::path::PathBuf::from(dir);
    if candidate.is_absolute() {
        return candidate;
    }
    let project_root =
        state.scenario_dir.parent().unwrap_or(&state.scenario_dir);
    project_root.join(dir)
}

// ── Config loading ─────────────────────────────────────

/// Load and parse tachyon.yaml from the project root.
fn load_tachyon_config(
    state: &AppState,
    config_path: Option<&str>,
) -> anyhow::Result<TachyonConfig> {
    let project_root =
        state.scenario_dir.parent().unwrap_or(&state.scenario_dir);

    let path = if let Some(p) = config_path {
        project_root.join(p)
    } else {
        let yaml_path = project_root.join("tachyon.yaml");
        let yml_path = project_root.join("tachyon.yml");
        if yaml_path.exists() {
            yaml_path
        } else if yml_path.exists() {
            yml_path
        } else {
            anyhow::bail!(
                "tachyon.yaml not found in {}",
                project_root.display()
            );
        }
    };

    let content = std::fs::read_to_string(&path)?;
    let config: TachyonConfig = serde_yaml::from_str(&content)?;
    Ok(config)
}

/// Resolve a scenario path relative to the scenario
/// directory.
fn resolve_scenario_path(state: &AppState, path: &str) -> PathBuf {
    let candidate = PathBuf::from(path);
    if candidate.is_absolute() {
        return candidate;
    }

    // Try relative to scenario_dir first
    let from_scenario_dir = state.scenario_dir.join(path);
    if from_scenario_dir.exists() {
        return from_scenario_dir;
    }

    // Then try from project root
    let project_root =
        state.scenario_dir.parent().unwrap_or(&state.scenario_dir);
    let from_root = project_root.join(path);
    if from_root.exists() {
        return from_root;
    }

    // Fall back to scenario_dir-relative
    from_scenario_dir
}

/// Load scenarios from a file or directory, optionally
/// filtering by name.
fn load_scenarios_from_path(
    state: &AppState,
    path: &PathBuf,
    filter: Option<&str>,
) -> Vec<TestScenario> {
    let mut scenarios = Vec::new();

    if path.is_file() {
        match state.config_manager.load_scenario(path) {
            Ok(s) => scenarios.push(s),
            Err(e) => {
                error!("Failed to load scenario {}: {}", path.display(), e);
            }
        }
    } else if path.is_dir() {
        match state.config_manager.load_scenarios_from_dir(path) {
            Ok(s) => scenarios.extend(s),
            Err(e) => {
                error!(
                    "Failed to load scenarios from {}: {}",
                    path.display(),
                    e
                );
            }
        }
    } else {
        warn!("Scenario path does not exist: {}", path.display());
    }

    // Apply filter
    if let Some(filter) = filter {
        let filter_lower = filter.to_lowercase();
        scenarios.retain(|s| s.name.to_lowercase().contains(&filter_lower));
    }

    scenarios
}

// ── GitHub Check Run ───────────────────────────────────

/// Create a GitHub Check Run with scenario results.
///
/// Returns the HTML URL of the created check run.
async fn create_github_check_run(
    token: &str,
    repository: &str,
    commit_sha: &str,
    deploy_url: &str,
    results: &[TestResult],
) -> anyhow::Result<String> {
    let all_passed = results.iter().all(|r| r.success);
    let total_duration: u64 = results.iter().map(|r| r.duration_ms).sum();

    let conclusion = if all_passed { "success" } else { "failure" };

    let title = if all_passed {
        format!("All {} post-deploy scenarios passed", results.len())
    } else {
        let failed = results.iter().filter(|r| !r.success).count();
        format!("{}/{} post-deploy scenarios failed", failed, results.len())
    };

    let summary =
        build_check_run_summary(deploy_url, results, total_duration);

    let annotations = build_check_run_annotations(results);

    let body = serde_json::json!({
        "name": "muon / post-deploy scenarios",
        "head_sha": commit_sha,
        "status": "completed",
        "conclusion": conclusion,
        "output": {
            "title": title,
            "summary": summary,
            "annotations": annotations,
        }
    });

    let client = reqwest::Client::new();
    let url =
        format!("https://api.github.com/repos/{repository}/check-runs");

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("User-Agent", "muon-scenario-runner")
        .json(&body)
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("GitHub API error: {} - {}", status, body);
    }

    let resp_body: serde_json::Value = resp.json().await?;
    let html_url = resp_body["html_url"].as_str().unwrap_or("").to_string();

    info!(
        check_run_url = %html_url,
        conclusion = %conclusion,
        "GitHub Check Run created"
    );

    Ok(html_url)
}

/// Build Markdown summary for the check run output.
fn build_check_run_summary(
    deploy_url: &str,
    results: &[TestResult],
    total_duration: u64,
) -> String {
    let passed = results.iter().filter(|r| r.success).count();
    let failed = results.len() - passed;

    let mut md = String::new();
    md.push_str("## Post-Deploy Scenario Results\n\n");
    md.push_str(&format!("**Deploy URL:** {deploy_url}\n\n"));
    md.push_str("| Metric | Value |\n|--------|-------|\n");
    md.push_str(&format!("| Total scenarios | {} |\n", results.len()));
    md.push_str(&format!("| Passed | {passed} |\n"));
    md.push_str(&format!("| Failed | {failed} |\n"));
    md.push_str(&format!("| Total duration | {total_duration} ms |\n\n"));

    md.push_str("### Scenario Details\n\n");
    md.push_str(
        "| Scenario | Status | Duration | Steps |\n\
         |----------|--------|----------|-------|\n",
    );

    for r in results {
        let status = if r.success {
            ":white_check_mark:"
        } else {
            ":x:"
        };
        let steps_passed = r.steps.iter().filter(|s| s.success).count();
        md.push_str(&format!(
            "| {} | {} | {} ms | {}/{} |\n",
            r.name,
            status,
            r.duration_ms,
            steps_passed,
            r.steps.len()
        ));
    }

    // Show failed step details
    let failed_scenarios: Vec<&TestResult> =
        results.iter().filter(|r| !r.success).collect();
    if !failed_scenarios.is_empty() {
        md.push_str("\n### Failed Steps\n\n");
        for r in failed_scenarios {
            for step in r.steps.iter().filter(|s| !s.success) {
                md.push_str(&format!(
                    "- **{}** > {}: {}\n",
                    r.name,
                    step.name,
                    step.error.as_deref().unwrap_or("unknown error")
                ));
            }
        }
    }

    md
}

/// Build annotations for failed steps.
fn build_check_run_annotations(
    results: &[TestResult],
) -> Vec<serde_json::Value> {
    let mut annotations = Vec::new();

    for result in results {
        for (i, step) in result.steps.iter().enumerate() {
            if !step.success {
                annotations.push(serde_json::json!({
                    "path": "tachyon.yaml",
                    "start_line": 1,
                    "end_line": 1,
                    "annotation_level": "failure",
                    "title": format!(
                        "{} - Step {}",
                        result.name,
                        i + 1
                    ),
                    "message": format!(
                        "Step '{}' failed: {}",
                        step.name,
                        step.error.as_deref()
                            .unwrap_or("unknown error")
                    ),
                }));
            }
        }
    }

    // GitHub limits to 50 annotations per request
    annotations.truncate(50);
    annotations
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deserialize_tachyon_config() {
        let yaml = r#"
postDeploy:
  scenarios:
    - path: tests/scenarios/smoke.yaml
      filter: health
      timeout: 60
    - path: tests/scenarios/api
  onFailure: rollback
"#;
        let config: TachyonConfig = serde_yaml::from_str(yaml).unwrap();
        let pd = config.post_deploy.unwrap();

        assert_eq!(pd.scenarios.len(), 2);
        assert_eq!(pd.scenarios[0].path, "tests/scenarios/smoke.yaml");
        assert_eq!(pd.scenarios[0].filter.as_deref(), Some("health"));
        assert_eq!(pd.scenarios[0].timeout, Some(60));
        assert_eq!(pd.scenarios[1].path, "tests/scenarios/api");
        assert_eq!(pd.scenarios[1].filter, None);
        assert_eq!(pd.on_failure, OnFailureAction::Rollback);
    }

    #[test]
    fn test_deserialize_on_failure_default() {
        let yaml = r#"
postDeploy:
  scenarios:
    - path: tests/scenarios/smoke.yaml
"#;
        let config: TachyonConfig = serde_yaml::from_str(yaml).unwrap();
        let pd = config.post_deploy.unwrap();
        assert_eq!(pd.on_failure, OnFailureAction::Notify);
    }

    #[test]
    fn test_deploy_payload_deserialization() {
        let json = r#"{
            "deploy_url": "https://preview-123.example.com",
            "commit_sha": "abc123",
            "repository": "owner/repo",
            "pr_number": 42
        }"#;
        let payload: DeployCompletePayload =
            serde_json::from_str(json).unwrap();

        assert_eq!(payload.deploy_url, "https://preview-123.example.com");
        assert_eq!(payload.environment, "preview");
        assert_eq!(payload.commit_sha, "abc123");
        assert_eq!(payload.repository, "owner/repo");
        assert_eq!(payload.pr_number, Some(42));
        assert!(payload.github_token.is_none());
    }

    #[test]
    fn test_build_check_run_summary() {
        let results = vec![
            TestResult {
                name: "smoke-test".to_string(),
                success: true,
                error: None,
                steps: vec![],
                duration_ms: 150,
            },
            TestResult {
                name: "api-test".to_string(),
                success: false,
                error: Some("Step failed".to_string()),
                steps: vec![],
                duration_ms: 300,
            },
        ];

        let summary = build_check_run_summary(
            "https://preview.example.com",
            &results,
            450,
        );

        assert!(summary.contains("Post-Deploy Scenario Results"));
        assert!(summary.contains("preview.example.com"));
        assert!(summary.contains("smoke-test"));
        assert!(summary.contains("api-test"));
        assert!(summary.contains("Passed | 1"));
        assert!(summary.contains("Failed | 1"));
    }

    #[test]
    fn test_on_failure_variants() {
        let notify: OnFailureAction =
            serde_yaml::from_str("notify").unwrap();
        assert_eq!(notify, OnFailureAction::Notify);

        let rollback: OnFailureAction =
            serde_yaml::from_str("rollback").unwrap();
        assert_eq!(rollback, OnFailureAction::Rollback);
    }

    #[test]
    fn test_deserialize_d1_databases() {
        let yaml = r#"
spec:
  d1Databases:
    - binding: DB
      databaseName: my-app-db
      migrationsDir: migrations
    - binding: ANALYTICS
      databaseName: analytics-db
postDeploy:
  scenarios:
    - path: tests/smoke.yaml
"#;
        let config: TachyonConfig = serde_yaml::from_str(yaml).unwrap();
        let spec = config.spec.unwrap();
        assert_eq!(spec.d1_databases.len(), 2);

        let db = &spec.d1_databases[0];
        assert_eq!(db.binding, "DB");
        assert_eq!(db.database_name, "my-app-db");
        assert_eq!(db.migrations_dir.as_deref(), Some("migrations"));

        let analytics = &spec.d1_databases[1];
        assert_eq!(analytics.binding, "ANALYTICS");
        assert_eq!(analytics.migrations_dir, None);

        // postDeploy still parsed correctly
        assert!(config.post_deploy.is_some());
    }

    #[test]
    fn test_deserialize_config_without_spec() {
        let yaml = r#"
postDeploy:
  scenarios:
    - path: tests/smoke.yaml
"#;
        let config: TachyonConfig = serde_yaml::from_str(yaml).unwrap();
        assert!(config.spec.is_none());
        assert!(config.post_deploy.is_some());
    }

    #[test]
    fn test_deserialize_deploy_payload_with_d1() {
        let json = r#"{
            "deploy_url": "https://preview.example.com",
            "commit_sha": "abc123",
            "repository": "owner/repo",
            "d1_bindings": [
                {
                    "binding_name": "DB",
                    "database_id": "abc-def-123"
                }
            ],
            "cloudflare_account_id": "cf-account-123",
            "cloudflare_api_token": "cf-token-xyz"
        }"#;
        let payload: DeployCompletePayload =
            serde_json::from_str(json).unwrap();

        assert_eq!(payload.d1_bindings.len(), 1);
        assert_eq!(payload.d1_bindings[0].binding_name, "DB");
        assert_eq!(payload.d1_bindings[0].database_id, "abc-def-123");
        assert_eq!(
            payload.cloudflare_account_id.as_deref(),
            Some("cf-account-123")
        );
        assert_eq!(
            payload.cloudflare_api_token.as_deref(),
            Some("cf-token-xyz")
        );
    }

    #[test]
    fn test_deserialize_deploy_payload_without_d1() {
        let json = r#"{
            "deploy_url": "https://preview.example.com",
            "commit_sha": "abc123",
            "repository": "owner/repo"
        }"#;
        let payload: DeployCompletePayload =
            serde_json::from_str(json).unwrap();

        assert!(payload.d1_bindings.is_empty());
        assert!(payload.cloudflare_account_id.is_none());
        assert!(payload.cloudflare_api_token.is_none());
    }
}
