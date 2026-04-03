//! Shared application state for the muon web server.

use super::repository::{self, RunRepository};
use crate::config::TestConfigManager;
use crate::model::{TestResult, TestScenario};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use tracing::{debug, warn};

/// Shared state accessible by all request handlers.
pub struct AppState {
    /// Loaded scenario metadata.
    pub scenarios: RwLock<Vec<ScenarioInfo>>,
    /// Run history persistence.
    pub run_repo: Arc<dyn RunRepository>,
    /// Directory being watched for scenario changes.
    pub scenario_dir: PathBuf,
    /// Config manager for loading scenarios.
    pub config_manager: TestConfigManager,
    /// Broadcast channel to notify clients of file
    /// changes.
    pub change_tx: broadcast::Sender<()>,
}

impl AppState {
    /// Create a new `AppState` with the default in-memory
    /// run repository.
    pub fn new(scenario_dir: PathBuf) -> Arc<Self> {
        Self::with_repository(scenario_dir, repository::in_memory())
    }

    /// Create a new `AppState` backed by the given
    /// repository.
    pub fn with_repository(
        scenario_dir: PathBuf,
        run_repo: Arc<dyn RunRepository>,
    ) -> Arc<Self> {
        let (change_tx, _) = broadcast::channel(16);
        let mut config_manager = TestConfigManager::new();
        config_manager.test_paths = vec![scenario_dir.clone()];

        Arc::new(Self {
            scenarios: RwLock::new(Vec::new()),
            run_repo,
            scenario_dir,
            config_manager,
            change_tx,
        })
    }

    /// Reload all scenarios from the configured directory.
    ///
    /// Reads each file individually so we can track the
    /// file path alongside the parsed scenario.
    pub async fn reload_scenarios(&self) {
        let dir = &self.scenario_dir;
        let entries = match std::fs::read_dir(dir) {
            Ok(entries) => entries,
            Err(e) => {
                warn!(
                    "Failed to read scenario dir {}: {}",
                    dir.display(),
                    e
                );
                return;
            }
        };

        let mut infos = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() || !is_scenario_file(&path) {
                continue;
            }
            match self.config_manager.load_scenario(&path) {
                Ok(scenario) => {
                    infos.push(ScenarioInfo::from_scenario(
                        &scenario, &path,
                    ));
                }
                Err(e) => {
                    debug!("Skipping {}: {}", path.display(), e);
                }
            }
        }

        debug!("Reloaded {} scenarios", infos.len());
        *self.scenarios.write().await = infos;
    }

    /// Load and parse a full [`TestScenario`] by file
    /// path.
    pub fn load_scenario_by_path(
        &self,
        file_path: &std::path::Path,
    ) -> anyhow::Result<TestScenario> {
        self.config_manager.load_scenario(file_path)
    }
}

/// Return `true` if the file looks like a scenario file.
fn is_scenario_file(path: &std::path::Path) -> bool {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

    if name.ends_with(".scenario.md") {
        return true;
    }
    if name.ends_with(".runbook.yml") || name.ends_with(".runbook.yaml") {
        return true;
    }
    path.extension()
        .is_some_and(|ext| ext == "yaml" || ext == "yml")
}

/// Summary metadata about a loaded scenario.
#[derive(Debug, Clone, Serialize)]
pub struct ScenarioInfo {
    /// Unique identifier (hash of file path).
    pub id: String,
    /// Scenario name from the YAML.
    pub name: String,
    /// Optional description.
    pub description: Option<String>,
    /// Tags for filtering.
    pub tags: Vec<String>,
    /// Number of steps in the scenario.
    pub step_count: usize,
    /// Path to the scenario file.
    pub file_path: PathBuf,
    /// Summary of the last run, if any.
    pub last_run: Option<RunSummary>,
}

impl ScenarioInfo {
    /// Build a `ScenarioInfo` from a parsed
    /// `TestScenario` and its file path.
    pub fn from_scenario(
        scenario: &TestScenario,
        file_path: &std::path::Path,
    ) -> Self {
        let id = format!("{:x}", hash_string(&file_path.to_string_lossy()));
        Self {
            id,
            name: scenario.name.clone(),
            description: scenario.description.clone(),
            tags: scenario.tags.clone(),
            step_count: scenario.steps.len(),
            file_path: file_path.to_path_buf(),
            last_run: None,
        }
    }
}

/// Quick summary of a past run.
#[derive(Debug, Clone, Serialize)]
pub struct RunSummary {
    pub id: String,
    pub success: bool,
    pub duration_ms: u64,
    pub finished_at: DateTime<Utc>,
}

/// Full record of a scenario execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunRecord {
    /// Unique run identifier.
    pub id: String,
    /// Scenario identifier this run belongs to.
    pub scenario_id: String,
    /// Scenario name.
    pub scenario_name: String,
    /// Test result (populated when finished).
    pub result: Option<TestResult>,
    /// When the run started.
    pub started_at: DateTime<Utc>,
    /// Current status.
    pub status: RunStatus,
}

/// Execution status of a run.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Pending,
    Running,
    Completed,
    Failed,
}

/// Simple hash function for generating stable IDs.
fn hash_string(input: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    input.hash(&mut hasher);
    hasher.finish()
}
