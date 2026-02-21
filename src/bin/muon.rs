//! Tachyon Scenario Runner CLI - API test execution tool.

use anyhow::{anyhow, Context, Result};
use chrono::Utc;
use clap::{Parser, ValueEnum};
use muon::{
    api_client::TachyonOpsClient, CiMetadata, DefaultTestRunner, TestConfigManager, TestResult,
    TestRunReport, TestRunner, TestScenario,
};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::exit;
use std::time::Instant;
use tracing::{debug, error, info};
use tracing_subscriber::{fmt, EnvFilter};

/// Tachyon Scenario Runner - YAML-based API test execution tool.
#[derive(Parser, Debug)]
#[command(name = "muon", version, about)]
struct Cli {
    /// Test file or directory path.
    #[arg(short = 'p', long = "path")]
    test_path: Option<String>,

    /// Filter tests by name (partial match).
    #[arg(short = 'f', long = "filter")]
    test_filter: Option<String>,

    /// Enable verbose logging.
    #[arg(short = 'v', long = "verbose")]
    verbose: bool,

    /// Timeout in seconds per test step.
    #[arg(short = 't', long = "timeout")]
    timeout: Option<u64>,

    /// Directory to save test report files.
    #[arg(short = 'r', long = "report-dir")]
    report_dir: Option<String>,

    /// Report output format.
    #[arg(long = "report-format", default_value = "json")]
    report_format: ReportFormat,

    /// Base URL override for all scenarios.
    #[arg(short = 'b', long = "base-url")]
    base_url: Option<String>,

    /// Tachyon Ops API URL for submitting test results.
    #[arg(long = "api-url", env = "TACHYON_OPS_API_URL")]
    api_url: Option<String>,

    /// API key for Tachyon Ops API authentication.
    #[arg(long = "api-key", env = "TACHYON_OPS_API_KEY")]
    api_key: Option<String>,

    /// Operator ID for multi-tenancy (x-operator-id header).
    #[arg(long = "operator-id", env = "TACHYON_OPS_OPERATOR_ID")]
    operator_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, ValueEnum)]
enum ReportFormat {
    Json,
    Yaml,
    Text,
}

fn init_tracing(verbose: bool) {
    if std::env::var_os("RUST_LOG").is_none() {
        let level = if verbose { "debug" } else { "info" };
        std::env::set_var("RUST_LOG", level);
    }

    if tracing::dispatcher::has_been_set() {
        return;
    }

    let _ = fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .with_target(false)
        .with_level(true)
        .with_thread_ids(false)
        .with_thread_names(false)
        .try_init();
}

fn print_test_result(result: &TestResult, verbose: bool) {
    let status = if result.success {
        "\x1b[32mPASS\x1b[0m"
    } else {
        "\x1b[31mFAIL\x1b[0m"
    };
    info!(
        "{} scenario: {} ({} ms)",
        status, result.name, result.duration_ms
    );

    for (i, step) in result.steps.iter().enumerate() {
        let step_status = if step.success {
            "\x1b[32m✓\x1b[0m"
        } else {
            "\x1b[31m✗\x1b[0m"
        };
        info!(
            "  {}. {} {} ({} ms)",
            i + 1,
            step_status,
            step.name,
            step.duration_ms
        );

        if let Some(error) = &step.error {
            error!("     \x1b[31mError: {}\x1b[0m", error);
        }

        if verbose {
            debug!("     Request: {} {}", step.request.method, step.request.url);
            if let Some(body) = &step.request.body {
                let truncated = if body.len() > 500 {
                    format!("{}...(truncated)", &body[..500])
                } else {
                    body.clone()
                };
                debug!("     Request body: {}", truncated);
            }

            if let Some(response) = &step.response {
                debug!("     Response: Status {}", response.status);
                if let Some(body) = &response.body {
                    let truncated = if body.len() > 500 {
                        format!("{}...(truncated)", &body[..500])
                    } else {
                        body.clone()
                    };
                    debug!("     Response body: {}", truncated);
                }
            }
        }
    }
}

fn save_test_report(
    result: &TestResult,
    report_dir: &Path,
    format: ReportFormat,
) -> Result<PathBuf> {
    if !report_dir.exists() {
        fs::create_dir_all(report_dir)?;
    }

    let timestamp = Utc::now().timestamp();
    let sanitized_name = result.name.replace([' ', '/'], "_");

    let (filename, content) = match format {
        ReportFormat::Json => {
            let filename = format!("{sanitized_name}-{timestamp}.json");
            let content = serde_json::to_string_pretty(result)?;
            (filename, content)
        }
        ReportFormat::Yaml => {
            let filename = format!("{sanitized_name}-{timestamp}.yaml");
            let content = serde_yaml::to_string(result)?;
            (filename, content)
        }
        ReportFormat::Text => {
            let filename = format!("{sanitized_name}-{timestamp}.txt");
            let mut content = String::new();
            content.push_str(&format!("Test result: {}\n", result.name));
            content.push_str(&format!(
                "Status: {}\n",
                if result.success { "PASS" } else { "FAIL" }
            ));
            if let Some(error) = &result.error {
                content.push_str(&format!("Error: {error}\n"));
            }
            content.push_str(&format!("Duration: {} ms\n\n", result.duration_ms));
            content.push_str("Steps:\n");
            for (i, step) in result.steps.iter().enumerate() {
                content.push_str(&format!(
                    "  {}. {} ({})\n",
                    i + 1,
                    step.name,
                    if step.success { "PASS" } else { "FAIL" }
                ));
                if let Some(error) = &step.error {
                    content.push_str(&format!("     Error: {error}\n"));
                }
                content.push_str(&format!("     Duration: {} ms\n", step.duration_ms));
            }
            (filename, content)
        }
    };

    let file_path = report_dir.join(filename);
    let mut file = File::create(&file_path)?;
    file.write_all(content.as_bytes())?;

    Ok(file_path)
}

fn prepare_config(test_path: Option<String>) -> Result<(TestConfigManager, Vec<TestScenario>)> {
    let mut config = TestConfigManager::new();

    let default_paths = ["tests/scenarios", "testcase/scenarios", "test/scenarios"];

    for path in &default_paths {
        if Path::new(path).exists() {
            config.add_path(path);
        }
    }
    config.add_path(".");

    let mut scenarios = Vec::new();

    if let Some(path) = test_path {
        let path = PathBuf::from(path);
        if !path.exists() {
            return Err(anyhow!("Path does not exist: {}", path.display()));
        }

        if path.is_file() {
            scenarios.push(
                config
                    .load_scenario(&path)
                    .context(format!("Failed to load scenario: {}", path.display()))?,
            );
        } else if path.is_dir() {
            let dir_scenarios = config.load_scenarios_from_dir(&path).context(format!(
                "Failed to load scenarios from directory: {}",
                path.display()
            ))?;
            scenarios.extend(dir_scenarios);
        }
    } else {
        scenarios = config.load_all_scenarios()?;
    }

    if scenarios.is_empty() {
        return Err(anyhow!("No test scenarios found"));
    }

    Ok((config, scenarios))
}

/// Detect CI metadata from environment variables.
fn detect_ci_metadata() -> Option<CiMetadata> {
    // GitHub Actions
    if std::env::var("GITHUB_ACTIONS").is_ok() {
        let repository = std::env::var("GITHUB_REPOSITORY").unwrap_or_default();
        let branch = std::env::var("GITHUB_REF_NAME")
            .or_else(|_| std::env::var("GITHUB_HEAD_REF"))
            .unwrap_or_default();
        let commit_sha = std::env::var("GITHUB_SHA").unwrap_or_default();
        let pr_number = std::env::var("PR_NUMBER")
            .or_else(|_| {
                // Try to extract from GITHUB_REF (refs/pull/123/merge)
                std::env::var("GITHUB_REF").map(|r| r.split('/').nth(2).unwrap_or("").to_string())
            })
            .ok()
            .and_then(|n| n.parse::<u64>().ok());
        let run_id = std::env::var("GITHUB_RUN_ID").ok();
        let run_url = run_id
            .as_ref()
            .map(|id| format!("https://github.com/{repository}/actions/runs/{id}"));

        return Some(CiMetadata {
            provider: "github".to_string(),
            repository,
            branch,
            commit_sha,
            pr_number,
            run_id,
            run_url,
        });
    }

    None
}

async fn run_all_tests(
    scenarios: Vec<TestScenario>,
    test_filter: Option<String>,
    timeout_override: Option<u64>,
    base_url_override: Option<String>,
    verbose: bool,
    report_dir: Option<&Path>,
    report_format: ReportFormat,
) -> Result<(bool, Vec<TestResult>)> {
    let runner = DefaultTestRunner::new();
    let mut all_success = true;
    let total_start = Instant::now();
    let mut passed = 0;
    let mut failed = 0;
    let mut results = Vec::new();

    let filtered: Vec<TestScenario> = match &test_filter {
        Some(filter) => scenarios
            .into_iter()
            .filter(|s| s.name.to_lowercase().contains(&filter.to_lowercase()))
            .collect(),
        None => scenarios,
    };

    if filtered.is_empty() {
        return Err(anyhow!("No tests matching the filter were found"));
    }

    let total_tests = filtered.len();
    info!("Running {} test(s)...", total_tests);

    for (idx, mut scenario) in filtered.into_iter().enumerate() {
        if let Some(timeout) = timeout_override {
            scenario.config.timeout = timeout;
        }
        if let Some(ref base_url) = base_url_override {
            scenario.config.base_url = Some(base_url.clone());
        }

        info!("Test {}/{}: {}", idx + 1, total_tests, scenario.name);
        match runner.run(&scenario).await {
            Ok(result) => {
                print_test_result(&result, verbose);

                if let Some(dir) = report_dir {
                    match save_test_report(&result, dir, report_format) {
                        Ok(path) => {
                            info!("Report saved: {}", path.display())
                        }
                        Err(e) => error!("Failed to save report: {}", e),
                    }
                }

                if result.success {
                    passed += 1;
                } else {
                    all_success = false;
                    failed += 1;
                }
                results.push(result);
            }
            Err(e) => {
                error!(
                    "\x1b[31mTest execution error: {} - {}\x1b[0m",
                    scenario.name, e
                );
                all_success = false;
                failed += 1;
            }
        }
    }

    let total_duration = total_start.elapsed().as_millis();
    info!(
        "Summary:\n  Total: {}\n  \x1b[32mPassed: {}\x1b[0m\n  \x1b[31mFailed: {}\x1b[0m\n  Duration: {} ms",
        passed + failed,
        passed,
        failed,
        total_duration
    );

    Ok((all_success, results))
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Cli::parse();

    init_tracing(args.verbose);

    let (_, scenarios) = prepare_config(args.test_path)?;

    let report_dir = args.report_dir.map(PathBuf::from);

    let total_start = Instant::now();

    let (success, results) = run_all_tests(
        scenarios,
        args.test_filter,
        args.timeout,
        args.base_url,
        args.verbose,
        report_dir.as_deref(),
        args.report_format,
    )
    .await?;

    // Submit report to Tachyon Ops API if configured
    if let (Some(api_url), Some(api_key)) = (args.api_url, args.api_key) {
        let report = TestRunReport {
            scenarios: results,
            total_duration_ms: total_start.elapsed().as_millis() as u64,
            timestamp: Utc::now().to_rfc3339(),
            ci: detect_ci_metadata(),
        };

        info!("Submitting test report to Tachyon Ops API...");
        let mut client = TachyonOpsClient::new(api_url, api_key);
        if let Some(operator_id) = args.operator_id {
            client = client.with_operator_id(operator_id);
        }
        match client.submit_report(&report).await {
            Ok(resp) => {
                info!("Report submitted (run_id: {})", resp.run_id);
                if let Some(url) = resp.dashboard_url {
                    info!("Dashboard: {}", url);
                }
            }
            Err(e) => {
                error!("Failed to submit report: {}", e);
                // Don't fail the process for report submission errors
            }
        }
    }

    if !success {
        exit(1);
    }

    Ok(())
}
