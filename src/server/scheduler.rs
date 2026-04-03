//! Cron-based scenario scheduler.
//!
//! Manages periodic execution of test scenarios using cron
//! expressions. Schedules are persisted as JSON in the
//! `.muon/schedules.json` file so they survive restarts.

use crate::runner::{DefaultTestRunner, TestRunner};
use crate::server::state::AppState;
use anyhow::{anyhow, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio_cron_scheduler::{Job, JobScheduler};
use tracing::{error, info, warn};

/// A persisted schedule definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Schedule {
    /// Unique identifier (UUID v4).
    pub id: String,
    /// Human-readable name.
    pub name: String,
    /// ID of the scenario to run (matches `ScenarioInfo.id`).
    pub scenario_id: String,
    /// Cron expression (e.g. `0 */5 * * * *` for every 5 min).
    pub cron_expr: String,
    /// Whether the schedule is active.
    pub enabled: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Timestamp of the last execution.
    pub last_run_at: Option<DateTime<Utc>>,
    /// Whether the last execution succeeded.
    pub last_run_success: Option<bool>,
}

/// Manages cron jobs and their lifecycle.
pub struct SchedulerManager {
    /// In-memory schedule store.
    schedules: RwLock<HashMap<String, Schedule>>,
    /// Maps schedule ID → cron job UUID for removal.
    job_ids: RwLock<HashMap<String, uuid::Uuid>>,
    /// The underlying cron scheduler.
    scheduler: JobScheduler,
    /// Path to the persistence file.
    persist_path: PathBuf,
    /// Reference to the shared app state.
    app_state: Arc<AppState>,
}

impl SchedulerManager {
    /// Create a new scheduler and restore persisted schedules.
    pub async fn new(
        app_state: Arc<AppState>,
        data_dir: &Path,
    ) -> Result<Arc<Self>> {
        let scheduler = JobScheduler::new()
            .await
            .map_err(|e| anyhow!("Failed to create job scheduler: {e}"))?;

        let persist_path = data_dir.join("schedules.json");

        let manager = Arc::new(Self {
            schedules: RwLock::new(HashMap::new()),
            job_ids: RwLock::new(HashMap::new()),
            scheduler,
            persist_path,
            app_state,
        });

        // Restore persisted schedules
        manager.load_from_disk().await?;

        // Register enabled schedules with the cron scheduler
        let schedule_ids: Vec<(String, bool)> = {
            let schedules = manager.schedules.read().await;
            schedules
                .values()
                .map(|s| (s.id.clone(), s.enabled))
                .collect()
        };

        for (id, enabled) in schedule_ids {
            if enabled {
                if let Err(e) = manager.register_cron_job(&id).await {
                    warn!(
                        "Failed to register cron job for \
                         schedule {id}: {e}"
                    );
                }
            }
        }

        manager
            .scheduler
            .start()
            .await
            .map_err(|e| anyhow!("Failed to start scheduler: {e}"))?;

        info!("Scheduler started");
        Ok(manager)
    }

    /// List all schedules.
    pub async fn list(&self) -> Vec<Schedule> {
        let schedules = self.schedules.read().await;
        let mut list: Vec<Schedule> = schedules.values().cloned().collect();
        list.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        list
    }

    /// Get a single schedule by ID.
    pub async fn get(&self, id: &str) -> Option<Schedule> {
        self.schedules.read().await.get(id).cloned()
    }

    /// Create a new schedule and optionally register it.
    pub async fn create(
        self: &Arc<Self>,
        name: String,
        scenario_id: String,
        cron_expr: String,
        enabled: bool,
    ) -> Result<Schedule> {
        // Validate cron expression early
        validate_cron(&cron_expr)?;

        // Verify scenario exists
        {
            let scenarios = self.app_state.scenarios.read().await;
            if !scenarios.iter().any(|s| s.id == scenario_id) {
                return Err(anyhow!("Scenario not found: {scenario_id}"));
            }
        }

        let now = Utc::now();
        let schedule = Schedule {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            scenario_id,
            cron_expr,
            enabled,
            created_at: now,
            updated_at: now,
            last_run_at: None,
            last_run_success: None,
        };

        {
            let mut schedules = self.schedules.write().await;
            schedules.insert(schedule.id.clone(), schedule.clone());
        }

        if enabled {
            self.register_cron_job(&schedule.id).await?;
        }

        self.persist().await?;
        info!("Created schedule '{}' ({})", schedule.name, schedule.id);
        Ok(schedule)
    }

    /// Update an existing schedule.
    pub async fn update(
        self: &Arc<Self>,
        id: &str,
        name: Option<String>,
        cron_expr: Option<String>,
        enabled: Option<bool>,
    ) -> Result<Schedule> {
        if let Some(ref expr) = cron_expr {
            validate_cron(expr)?;
        }

        // Remove old cron job if it exists
        self.unregister_cron_job(id).await;

        let schedule = {
            let mut schedules = self.schedules.write().await;
            let schedule = schedules
                .get_mut(id)
                .ok_or_else(|| anyhow!("Schedule not found: {id}"))?;

            if let Some(name) = name {
                schedule.name = name;
            }
            if let Some(expr) = cron_expr {
                schedule.cron_expr = expr;
            }
            if let Some(enabled) = enabled {
                schedule.enabled = enabled;
            }
            schedule.updated_at = Utc::now();
            schedule.clone()
        };

        if schedule.enabled {
            self.register_cron_job(id).await?;
        }

        self.persist().await?;
        info!("Updated schedule '{}' ({})", schedule.name, id);
        Ok(schedule)
    }

    /// Delete a schedule.
    pub async fn delete(&self, id: &str) -> Result<()> {
        self.unregister_cron_job(id).await;

        let mut schedules = self.schedules.write().await;
        schedules
            .remove(id)
            .ok_or_else(|| anyhow!("Schedule not found: {id}"))?;
        drop(schedules);

        self.persist().await?;
        info!("Deleted schedule {id}");
        Ok(())
    }

    /// Manually trigger a schedule's scenario immediately.
    pub async fn trigger(self: &Arc<Self>, id: &str) -> Result<String> {
        let schedule = self
            .get(id)
            .await
            .ok_or_else(|| anyhow!("Schedule not found: {id}"))?;

        let run_id =
            execute_scenario(self.app_state.clone(), &schedule).await?;

        // Update last-run metadata
        {
            let mut schedules = self.schedules.write().await;
            if let Some(s) = schedules.get_mut(id) {
                s.last_run_at = Some(Utc::now());
            }
        }
        let _ = self.persist().await;

        Ok(run_id)
    }

    /// Return the number of active (enabled) schedules.
    pub async fn active_count(&self) -> usize {
        self.schedules
            .read()
            .await
            .values()
            .filter(|s| s.enabled)
            .count()
    }

    // ── Internal helpers ─────────────────────────────────

    /// Register a cron job for the given schedule ID.
    async fn register_cron_job(
        self: &Arc<Self>,
        schedule_id: &str,
    ) -> Result<()> {
        let schedule = {
            let schedules = self.schedules.read().await;
            schedules.get(schedule_id).cloned().ok_or_else(|| {
                anyhow!("Schedule not found: {schedule_id}")
            })?
        };

        let mgr = Arc::clone(self);
        let sid = schedule_id.to_string();

        let job = Job::new_async(
            schedule.cron_expr.as_str(),
            move |_uuid, _lock| {
                let mgr = Arc::clone(&mgr);
                let sid = sid.clone();
                Box::pin(async move {
                    info!("Cron fired for schedule {sid}");
                    let sched = {
                        let schedules = mgr.schedules.read().await;
                        schedules.get(&sid).cloned()
                    };
                    let Some(sched) = sched else {
                        warn!("Schedule {sid} no longer exists");
                        return;
                    };
                    let success = match execute_scenario(
                        mgr.app_state.clone(),
                        &sched,
                    )
                    .await
                    {
                        Ok(run_id) => {
                            info!(
                                "Schedule {sid} completed \
                                 (run {run_id})"
                            );
                            true
                        }
                        Err(e) => {
                            error!("Schedule {sid} failed: {e}");
                            false
                        }
                    };

                    // Update last-run metadata
                    {
                        let mut schedules = mgr.schedules.write().await;
                        if let Some(s) = schedules.get_mut(&sid) {
                            s.last_run_at = Some(Utc::now());
                            s.last_run_success = Some(success);
                        }
                    }
                    let _ = mgr.persist().await;
                })
            },
        )
        .map_err(|e| anyhow!("Invalid cron expression: {e}"))?;

        let job_uuid = job.guid();
        self.scheduler
            .add(job)
            .await
            .map_err(|e| anyhow!("Failed to add cron job: {e}"))?;

        self.job_ids
            .write()
            .await
            .insert(schedule_id.to_string(), job_uuid);

        Ok(())
    }

    /// Remove the cron job for the given schedule.
    async fn unregister_cron_job(&self, schedule_id: &str) {
        let job_uuid = self.job_ids.write().await.remove(schedule_id);
        if let Some(uuid) = job_uuid {
            if let Err(e) = self.scheduler.remove(&uuid).await {
                warn!(
                    "Failed to remove cron job for \
                     {schedule_id}: {e}"
                );
            }
        }
    }

    /// Persist schedules to disk.
    async fn persist(&self) -> Result<()> {
        let schedules = self.schedules.read().await;
        let list: Vec<&Schedule> = schedules.values().collect();
        let json = serde_json::to_string_pretty(&list)?;

        if let Some(parent) = self.persist_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&self.persist_path, json)?;

        Ok(())
    }

    /// Load schedules from disk.
    async fn load_from_disk(&self) -> Result<()> {
        if !self.persist_path.exists() {
            return Ok(());
        }

        let json = std::fs::read_to_string(&self.persist_path)?;
        let list: Vec<Schedule> = serde_json::from_str(&json)?;

        let mut schedules = self.schedules.write().await;
        for s in list {
            schedules.insert(s.id.clone(), s);
        }

        info!(
            "Loaded {} schedule(s) from {}",
            schedules.len(),
            self.persist_path.display()
        );
        Ok(())
    }
}

/// Validate that a cron expression is parseable.
fn validate_cron(expr: &str) -> Result<()> {
    // Try to create a job to validate the expression.
    // tokio-cron-scheduler uses 6-field cron (sec min hour
    // day month weekday).
    let _job = Job::new(expr, |_uuid, _lock| {})
        .map_err(|e| anyhow!("Invalid cron expression '{expr}': {e}"))?;
    Ok(())
}

/// Execute a scenario and record the run in AppState.
async fn execute_scenario(
    app_state: Arc<AppState>,
    schedule: &Schedule,
) -> Result<String> {
    // Resolve scenario file path
    let file_path = {
        let scenarios = app_state.scenarios.read().await;
        scenarios
            .iter()
            .find(|s| s.id == schedule.scenario_id)
            .map(|s| s.file_path.clone())
            .ok_or_else(|| {
                anyhow!("Scenario {} not found", schedule.scenario_id)
            })?
    };

    let scenario = app_state.load_scenario_by_path(&file_path)?;

    let run_id = uuid::Uuid::new_v4().to_string();
    let run_record = crate::server::state::RunRecord {
        id: run_id.clone(),
        scenario_id: schedule.scenario_id.clone(),
        scenario_name: scenario.name.clone(),
        result: None,
        started_at: Utc::now(),
        status: crate::server::state::RunStatus::Running,
    };
    app_state
        .runs
        .write()
        .await
        .insert(run_id.clone(), run_record);

    let runner = DefaultTestRunner::new();
    let result = runner.run(&scenario).await;

    let success = {
        let mut runs = app_state.runs.write().await;
        if let Some(record) = runs.get_mut(&run_id) {
            match result {
                Ok(test_result) => {
                    record.status = if test_result.success {
                        crate::server::state::RunStatus::Completed
                    } else {
                        crate::server::state::RunStatus::Failed
                    };
                    record.result = Some(test_result);
                    true
                }
                Err(ref e) => {
                    error!("Scheduled run {run_id} failed: {e}");
                    record.status = crate::server::state::RunStatus::Failed;
                    false
                }
            }
        } else {
            false
        }
    };

    if success {
        Ok(run_id)
    } else {
        Err(anyhow!("Scenario execution failed"))
    }
}
