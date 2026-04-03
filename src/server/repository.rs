//! Run history persistence layer.
//!
//! Provides a [`RunRepository`] trait with two concrete
//! implementations:
//! - [`InMemoryRunRepository`] – default, no external deps.
//! - [`SqlxRunRepository`]     – MySQL / TiDB backed.

use super::state::{RunRecord, RunStatus};
use anyhow::{Context, Result};
use async_trait::async_trait;
use chrono::{TimeZone, Utc};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

// ── trait ──────────────────────────────────────────────

/// Persistence abstraction for scenario run records.
#[async_trait]
pub trait RunRepository: Send + Sync {
    /// Insert a new run record.
    async fn insert(&self, record: &RunRecord) -> Result<()>;
    /// Update an existing run record (by `record.id`).
    async fn update(&self, record: &RunRecord) -> Result<()>;
    /// Fetch a single run by ID.
    async fn get(&self, id: &str) -> Result<Option<RunRecord>>;
    /// List all runs, newest first.
    async fn list_all(&self) -> Result<Vec<RunRecord>>;
}

// ── in-memory impl ────────────────────────────────────

/// Volatile, in-process store – used when no
/// `--database-url` is provided.
pub struct InMemoryRunRepository {
    runs: RwLock<HashMap<String, RunRecord>>,
}

impl InMemoryRunRepository {
    pub fn new() -> Self {
        Self {
            runs: RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl RunRepository for InMemoryRunRepository {
    async fn insert(&self, record: &RunRecord) -> Result<()> {
        self.runs
            .write()
            .await
            .insert(record.id.clone(), record.clone());
        Ok(())
    }

    async fn update(&self, record: &RunRecord) -> Result<()> {
        self.runs
            .write()
            .await
            .insert(record.id.clone(), record.clone());
        Ok(())
    }

    async fn get(&self, id: &str) -> Result<Option<RunRecord>> {
        Ok(self.runs.read().await.get(id).cloned())
    }

    async fn list_all(&self) -> Result<Vec<RunRecord>> {
        let runs = self.runs.read().await;
        let mut records: Vec<RunRecord> = runs.values().cloned().collect();
        records.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        Ok(records)
    }
}

// ── MySQL / TiDB impl ────────────────────────────────

/// Durable store backed by a MySQL / TiDB connection
/// pool.
///
/// Uses `sqlx::query()` + `.bind()` instead of the
/// compile-time `query!` macros because the database
/// connection is optional (only present when the user
/// passes `--database-url`).
pub struct SqlxRunRepository {
    pool: sqlx::MySqlPool,
}

impl SqlxRunRepository {
    /// Connect to the database and run pending
    /// migrations.
    pub async fn new(database_url: &str) -> Result<Self> {
        let pool = sqlx::MySqlPool::connect(database_url)
            .await
            .context("failed to connect to database")?;

        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .context("failed to run migrations")?;

        info!("Database connected and migrated");
        Ok(Self { pool })
    }
}

#[async_trait]
impl RunRepository for SqlxRunRepository {
    async fn insert(&self, record: &RunRecord) -> Result<()> {
        let status_str = status_to_str(&record.status);
        let result_json: Option<String> = record
            .result
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;
        let success = record.result.as_ref().map(|r| r.success);
        let duration = record.result.as_ref().map(|r| r.duration_ms as i64);
        let error = record.result.as_ref().and_then(|r| r.error.clone());

        sqlx::query(
            "INSERT INTO monitoring_runs \
             (id, scenario_id, scenario_name, \
              status, success, error, result_json, \
              duration_ms, started_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&record.id)
        .bind(&record.scenario_id)
        .bind(&record.scenario_name)
        .bind(status_str)
        .bind(success)
        .bind(&error)
        .bind(&result_json)
        .bind(duration)
        .bind(record.started_at)
        .execute(&self.pool)
        .await
        .context("failed to insert run")?;
        Ok(())
    }

    async fn update(&self, record: &RunRecord) -> Result<()> {
        let status_str = status_to_str(&record.status);
        let result_json: Option<String> = record
            .result
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;
        let success = record.result.as_ref().map(|r| r.success);
        let duration = record.result.as_ref().map(|r| r.duration_ms as i64);
        let error = record.result.as_ref().and_then(|r| r.error.clone());
        let finished = if matches!(
            record.status,
            RunStatus::Completed | RunStatus::Failed
        ) {
            Some(Utc::now())
        } else {
            None
        };

        sqlx::query(
            "UPDATE monitoring_runs \
             SET status = ?, success = ?, \
                 error = ?, result_json = ?, \
                 duration_ms = ?, finished_at = ? \
             WHERE id = ?",
        )
        .bind(status_str)
        .bind(success)
        .bind(&error)
        .bind(&result_json)
        .bind(duration)
        .bind(finished)
        .bind(&record.id)
        .execute(&self.pool)
        .await
        .context("failed to update run")?;
        Ok(())
    }

    async fn get(&self, id: &str) -> Result<Option<RunRecord>> {
        let row: Option<SqlxRow> = sqlx::query_as(
            "SELECT id, scenario_id, scenario_name, \
             status, result_json, started_at \
             FROM monitoring_runs WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .context("failed to fetch run")?;

        row.map(|r| r.into_record()).transpose()
    }

    async fn list_all(&self) -> Result<Vec<RunRecord>> {
        let rows: Vec<SqlxRow> = sqlx::query_as(
            "SELECT id, scenario_id, scenario_name, \
             status, result_json, started_at \
             FROM monitoring_runs \
             ORDER BY started_at DESC \
             LIMIT 500",
        )
        .fetch_all(&self.pool)
        .await
        .context("failed to list runs")?;

        rows.into_iter().map(|r| r.into_record()).collect()
    }
}

// ── helpers ───────────────────────────────────────────

/// Intermediate row type for sqlx deserialization.
#[derive(sqlx::FromRow)]
struct SqlxRow {
    id: String,
    scenario_id: String,
    scenario_name: String,
    status: String,
    result_json: Option<String>,
    started_at: chrono::NaiveDateTime,
}

impl SqlxRow {
    fn into_record(self) -> Result<RunRecord> {
        let status = status_from_str(&self.status);
        let result = self
            .result_json
            .map(|j| serde_json::from_str(&j))
            .transpose()
            .context("invalid result_json")?;
        let started_at = Utc.from_utc_datetime(&self.started_at);
        Ok(RunRecord {
            id: self.id,
            scenario_id: self.scenario_id,
            scenario_name: self.scenario_name,
            result,
            started_at,
            status,
        })
    }
}

fn status_to_str(s: &RunStatus) -> &'static str {
    match s {
        RunStatus::Pending => "pending",
        RunStatus::Running => "running",
        RunStatus::Completed => "completed",
        RunStatus::Failed => "failed",
    }
}

fn status_from_str(s: &str) -> RunStatus {
    match s {
        "running" => RunStatus::Running,
        "completed" => RunStatus::Completed,
        "failed" => RunStatus::Failed,
        _ => RunStatus::Pending,
    }
}

/// Helper to construct the default in-memory repository.
pub fn in_memory() -> Arc<dyn RunRepository> {
    Arc::new(InMemoryRunRepository::new())
}
