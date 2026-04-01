use crate::db::{HistoryDb, RunHistoryEntry};
use crate::import;
use muon::model::{TestScenario, TestStep};
use muon::runner::{DefaultTestRunner, RunEvent};
use muon::TestConfigManager;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use tauri::{Emitter, State, Window};
use tokio::sync::mpsc;

// ── Response types ────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct ScenarioSummary {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub tags: Vec<String>,
    pub step_count: usize,
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScenarioDetail {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub tags: Vec<String>,
    pub steps: Vec<TestStep>,
    pub vars: HashMap<String, serde_json::Value>,
    pub config: muon::model::TestConfig,
    pub file_path: String,
    pub raw_yaml: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ValidationResult {
    pub valid: bool,
    pub errors: Vec<ValidationError>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ValidationError {
    pub line: Option<usize>,
    pub column: Option<usize>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Environment {
    pub name: String,
    #[serde(default)]
    pub variables: HashMap<String, String>,
    #[serde(default)]
    pub sensitive_keys: Vec<String>,
}

// ── Helpers ───────────────────────────────────────────

/// Hash a string to produce a stable hex identifier.
fn hash_id(input: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher =
        std::collections::hash_map::DefaultHasher::new();
    input.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

/// Build a `ScenarioSummary` from a parsed scenario and path.
fn to_summary(
    scenario: &TestScenario,
    path: &std::path::Path,
) -> ScenarioSummary {
    ScenarioSummary {
        id: hash_id(&path.to_string_lossy()),
        name: scenario.name.clone(),
        description: scenario.description.clone(),
        tags: scenario.tags.clone(),
        step_count: scenario.steps.len(),
        file_path: path.to_string_lossy().to_string(),
    }
}

/// Resolve environments directory from a project path.
fn env_dir(project_path: &str) -> PathBuf {
    PathBuf::from(project_path)
        .join(".muon")
        .join("environments")
}

/// Find a scenario file by its hash ID in a directory.
fn find_scenario_path(
    dir: &str,
    id: &str,
) -> Result<PathBuf, String> {
    let dir_path = PathBuf::from(dir);
    let entries = std::fs::read_dir(&dir_path)
        .map_err(|e| format!("Cannot read directory: {e}"))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && is_scenario_file(&path) {
            let candidate = hash_id(&path.to_string_lossy());
            if candidate == id {
                return Ok(path);
            }
        }
    }
    Err(format!("Scenario with id '{id}' not found"))
}

fn is_scenario_file(path: &std::path::Path) -> bool {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");

    if name.ends_with(".scenario.md") {
        return true;
    }
    if name.ends_with(".runbook.yml")
        || name.ends_with(".runbook.yaml")
    {
        return true;
    }
    path.extension()
        .is_some_and(|ext| ext == "yaml" || ext == "yml")
}

// ── Tauri IPC Commands ────────────────────────────────

#[tauri::command]
pub fn list_scenarios(
    path: String,
) -> Result<Vec<ScenarioSummary>, String> {
    let mut mgr = TestConfigManager::new();
    mgr.add_path(&path);
    let scenarios = mgr
        .load_scenarios_from_dir(&path)
        .map_err(|e| e.to_string())?;

    let dir = PathBuf::from(&path);
    let entries = std::fs::read_dir(&dir)
        .map_err(|e| format!("Cannot read directory: {e}"))?;

    let mut summaries = Vec::new();
    for entry in entries.flatten() {
        let file_path = entry.path();
        if !file_path.is_file() || !is_scenario_file(&file_path) {
            continue;
        }
        if let Ok(scenario) = mgr.load_scenario(&file_path) {
            summaries.push(to_summary(&scenario, &file_path));
        }
    }
    Ok(summaries)
}

#[tauri::command]
pub fn get_scenario(
    path: String,
    id: String,
) -> Result<ScenarioDetail, String> {
    let file_path = find_scenario_path(&path, &id)?;
    let mgr = TestConfigManager::new();
    let scenario = mgr
        .load_scenario(&file_path)
        .map_err(|e| e.to_string())?;
    let raw_yaml = std::fs::read_to_string(&file_path)
        .map_err(|e| e.to_string())?;

    Ok(ScenarioDetail {
        id,
        name: scenario.name.clone(),
        description: scenario.description.clone(),
        tags: scenario.tags.clone(),
        steps: scenario.steps.clone(),
        vars: scenario.vars.clone(),
        config: scenario.config.clone(),
        file_path: file_path.to_string_lossy().to_string(),
        raw_yaml,
    })
}

#[tauri::command]
pub async fn run_scenario(
    path: String,
    id: String,
    db: State<'_, Arc<HistoryDb>>,
    window: Window,
) -> Result<(), String> {
    let file_path = find_scenario_path(&path, &id)?;
    let mgr = TestConfigManager::new();
    let scenario = mgr
        .load_scenario(&file_path)
        .map_err(|e| e.to_string())?;

    let runner = DefaultTestRunner::new();
    let (tx, mut rx) = mpsc::channel::<RunEvent>(64);

    // Spawn a task to forward events to the Tauri window
    let win = window.clone();
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            let _ = win.emit("run-event", &event);
        }
    });

    let result = runner
        .run_with_events(&scenario, tx)
        .await
        .map_err(|e| e.to_string())?;

    // Persist to history DB
    let steps_json = serde_json::to_string(&result.steps)
        .unwrap_or_default();
    let _ = db.save_run(
        &result.name,
        &file_path.to_string_lossy(),
        result.success,
        result.error.as_deref(),
        &steps_json,
        result.duration_ms,
    );

    Ok(())
}

// ── Batch event types ────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct BatchStarted {
    pub total: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct BatchScenarioStarted {
    pub index: usize,
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BatchScenarioCompleted {
    pub index: usize,
    pub id: String,
    pub success: bool,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct BatchCompleted {
    pub total: usize,
    pub passed: usize,
    pub failed: usize,
    pub duration_ms: u64,
}

#[tauri::command]
pub async fn run_multiple_scenarios(
    path: String,
    ids: Vec<String>,
    db: State<'_, Arc<HistoryDb>>,
    window: Window,
) -> Result<(), String> {
    let total = ids.len();
    let batch_start = Instant::now();

    let _ = window.emit(
        "batch-started",
        &BatchStarted { total },
    );

    let mut passed: usize = 0;
    let mut failed: usize = 0;

    for (index, id) in ids.iter().enumerate() {
        let file_path = find_scenario_path(&path, id)?;
        let mgr = TestConfigManager::new();
        let scenario = mgr
            .load_scenario(&file_path)
            .map_err(|e| e.to_string())?;

        let _ = window.emit(
            "batch-scenario-started",
            &BatchScenarioStarted {
                index,
                id: id.clone(),
                name: scenario.name.clone(),
            },
        );

        let scenario_start = Instant::now();
        let runner = DefaultTestRunner::new();
        let (tx, mut rx) = mpsc::channel::<RunEvent>(64);

        // Forward step events to the Tauri window
        let win = window.clone();
        tokio::spawn(async move {
            while let Some(event) = rx.recv().await {
                let _ = win.emit("run-event", &event);
            }
        });

        let run_result = runner
            .run_with_events(&scenario, tx)
            .await;

        let scenario_duration =
            scenario_start.elapsed().as_millis() as u64;

        let success = match &run_result {
            Ok(result) => {
                // Persist to history DB
                let steps_json =
                    serde_json::to_string(&result.steps)
                        .unwrap_or_default();
                let _ = db.save_run(
                    &result.name,
                    &file_path.to_string_lossy(),
                    result.success,
                    result.error.as_deref(),
                    &steps_json,
                    result.duration_ms,
                );
                result.success
            }
            Err(_) => false,
        };

        if success {
            passed += 1;
        } else {
            failed += 1;
        }

        let _ = window.emit(
            "batch-scenario-completed",
            &BatchScenarioCompleted {
                index,
                id: id.clone(),
                success,
                duration_ms: scenario_duration,
            },
        );
    }

    let batch_duration =
        batch_start.elapsed().as_millis() as u64;

    let _ = window.emit(
        "batch-completed",
        &BatchCompleted {
            total,
            passed,
            failed,
            duration_ms: batch_duration,
        },
    );

    Ok(())
}

#[tauri::command]
pub fn create_scenario(
    path: String,
    scenario_json: String,
) -> Result<ScenarioSummary, String> {
    let scenario: TestScenario = serde_json::from_str(&scenario_json)
        .map_err(|e| format!("Invalid scenario JSON: {e}"))?;
    let yaml = scenario.to_yaml().map_err(|e| e.to_string())?;

    let file_name = sanitize_filename(&scenario.name);
    let file_path = PathBuf::from(&path).join(file_name);

    if file_path.exists() {
        return Err(format!(
            "File already exists: {}",
            file_path.display()
        ));
    }

    std::fs::write(&file_path, &yaml)
        .map_err(|e| format!("Failed to write file: {e}"))?;

    Ok(to_summary(&scenario, &file_path))
}

#[tauri::command]
pub fn update_scenario(
    path: String,
    id: String,
    scenario_json: String,
) -> Result<ScenarioSummary, String> {
    let file_path = find_scenario_path(&path, &id)?;
    let scenario: TestScenario = serde_json::from_str(&scenario_json)
        .map_err(|e| format!("Invalid scenario JSON: {e}"))?;
    let yaml = scenario.to_yaml().map_err(|e| e.to_string())?;

    std::fs::write(&file_path, &yaml)
        .map_err(|e| format!("Failed to write file: {e}"))?;

    Ok(to_summary(&scenario, &file_path))
}

#[tauri::command]
pub fn delete_scenario(
    path: String,
    id: String,
) -> Result<bool, String> {
    let file_path = find_scenario_path(&path, &id)?;
    std::fs::remove_file(&file_path)
        .map_err(|e| format!("Failed to delete: {e}"))?;
    Ok(true)
}

#[tauri::command]
pub fn validate_yaml(yaml_string: String) -> ValidationResult {
    match serde_yaml::from_str::<TestScenario>(&yaml_string) {
        Ok(_) => ValidationResult {
            valid: true,
            errors: Vec::new(),
        },
        Err(e) => {
            let location = e.location();
            ValidationResult {
                valid: false,
                errors: vec![ValidationError {
                    line: location.as_ref().map(|l| l.line()),
                    column: location.as_ref().map(|l| l.column()),
                    message: e.to_string(),
                }],
            }
        }
    }
}

#[tauri::command]
pub fn list_environments(
    path: String,
) -> Result<Vec<Environment>, String> {
    let dir = env_dir(&path);
    let mut envs = Vec::new();

    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.extension()
                .is_some_and(|e| e == "yaml" || e == "yml")
            {
                if let Ok(content) = std::fs::read_to_string(&p) {
                    if let Ok(env) =
                        serde_yaml::from_str::<Environment>(
                            &content,
                        )
                    {
                        envs.push(env);
                    }
                }
            }
        }
    }

    envs.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(envs)
}

#[tauri::command]
pub fn save_environment(
    path: String,
    name: String,
    env_json: String,
) -> Result<(), String> {
    let env: Environment = serde_json::from_str(&env_json)
        .map_err(|e| format!("Invalid environment JSON: {e}"))?;

    let dir = env_dir(&path);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create dir: {e}"))?;

    let yaml =
        serde_yaml::to_string(&env).map_err(|e| e.to_string())?;
    let file_path = dir.join(format!("{name}.yaml"));
    std::fs::write(&file_path, &yaml)
        .map_err(|e| format!("Failed to write: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn delete_environment(
    path: String,
    name: String,
) -> Result<(), String> {
    let file_path = env_dir(&path).join(format!("{name}.yaml"));
    if !file_path.exists() {
        return Err(format!("Environment '{name}' not found"));
    }
    std::fs::remove_file(&file_path)
        .map_err(|e| format!("Failed to delete: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn import_postman(
    collection_json: String,
) -> Result<Vec<TestScenario>, String> {
    import::postman::parse_collection(&collection_json)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_curl(
    curl_command: String,
) -> Result<TestStep, String> {
    import::curl::parse_curl(&curl_command)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_openapi(
    spec_json: String,
    base_url: String,
) -> Result<Vec<TestScenario>, String> {
    import::openapi::parse_spec(&spec_json, &base_url)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_run_history(
    limit: Option<u32>,
    db: State<'_, Arc<HistoryDb>>,
) -> Result<Vec<RunHistoryEntry>, String> {
    let limit = limit.unwrap_or(50);
    db.list_runs(limit, 0).map_err(|e| e.to_string())
}

// ── Project management ───────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct ProjectInfo {
    pub name: String,
    pub path: String,
    pub scenario_count: usize,
}

#[tauri::command]
pub fn open_project(
    path: String,
) -> Result<ProjectInfo, String> {
    let dir = PathBuf::from(&path);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {path}"));
    }
    let name = dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Project")
        .to_string();

    // Count scenario files
    let scenario_count = std::fs::read_dir(&dir)
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| {
                    e.path().is_file()
                        && is_scenario_file(&e.path())
                })
                .count()
        })
        .unwrap_or(0);

    Ok(ProjectInfo {
        name,
        path,
        scenario_count,
    })
}

#[tauri::command]
pub fn create_project(
    path: String,
) -> Result<ProjectInfo, String> {
    let dir = PathBuf::from(&path);

    // Create the project directory and .muon/environments
    std::fs::create_dir_all(dir.join(".muon").join("environments"))
        .map_err(|e| format!("Failed to create project: {e}"))?;

    let name = dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Project")
        .to_string();

    Ok(ProjectInfo {
        name,
        path,
        scenario_count: 0,
    })
}

// ── Ad-hoc HTTP Request ─────────────────────────────

#[derive(Debug, Clone, Deserialize)]
pub struct HttpRequestPayload {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
    /// Timeout in seconds (default 30).
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HttpResponsePayload {
    pub status: u16,
    pub status_text: String,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub duration_ms: u64,
    pub size_bytes: usize,
}

#[tauri::command]
pub async fn send_http_request(
    payload: HttpRequestPayload,
) -> Result<HttpResponsePayload, String> {
    let timeout = std::time::Duration::from_secs(
        payload.timeout_secs.unwrap_or(30),
    );

    let client = reqwest::Client::builder()
        .timeout(timeout)
        .danger_accept_invalid_certs(true)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| {
            format!("Failed to build HTTP client: {e}")
        })?;

    let method: reqwest::Method = payload.method.parse().map_err(
        |_| format!("Invalid HTTP method: {}", payload.method),
    )?;

    let mut request = client.request(method, &payload.url);

    for (k, v) in &payload.headers {
        request = request.header(k.as_str(), v.as_str());
    }

    if let Some(ref body) = payload.body {
        request = request.body(body.clone());
    }

    let start = Instant::now();
    let response = request
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;
    let duration_ms = start.elapsed().as_millis() as u64;

    let status = response.status().as_u16();
    let status_text = response
        .status()
        .canonical_reason()
        .unwrap_or("")
        .to_string();

    let mut headers: HashMap<String, String> =
        HashMap::new();
    for (k, v) in response.headers().iter() {
        let value =
            v.to_str().unwrap_or("<binary>").to_string();
        headers
            .entry(k.as_str().to_string())
            .and_modify(|existing| {
                existing.push_str(", ");
                existing.push_str(&value);
            })
            .or_insert(value);
    }

    let body_bytes = response.bytes().await.map_err(|e| {
        format!("Failed to read response body: {e}")
    })?;
    let size_bytes = body_bytes.len();
    let body =
        String::from_utf8_lossy(&body_bytes).to_string();

    Ok(HttpResponsePayload {
        status,
        status_text,
        headers,
        body,
        duration_ms,
        size_bytes,
    })
}

/// Convert a scenario name to a safe YAML filename.
fn sanitize_filename(name: &str) -> String {
    let slug: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c.to_ascii_lowercase()
            } else if c.is_whitespace() {
                '-'
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = slug.trim_matches(|c| c == '-' || c == '_');
    if trimmed.is_empty() {
        "scenario.yaml".to_string()
    } else {
        format!("{trimmed}.yaml")
    }
}
