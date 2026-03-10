use anyhow::{Context, Result};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

/// SQLite-backed storage for execution history.
pub struct HistoryDb {
    conn: Mutex<Connection>,
}

/// A single run history entry persisted to SQLite.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunHistoryEntry {
    pub id: i64,
    pub scenario_name: String,
    pub scenario_path: String,
    pub success: bool,
    pub error: Option<String>,
    pub steps_json: String,
    pub duration_ms: u64,
    pub timestamp: String,
}

impl HistoryDb {
    /// Open (or create) the history database at the given path.
    pub fn open(db_path: &Path) -> Result<Self> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)
                .context("failed to create db directory")?;
        }
        let conn = Connection::open(db_path)
            .context("failed to open SQLite database")?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.initialize()?;
        Ok(db)
    }

    /// Create the schema if it doesn't exist.
    fn initialize(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS run_history (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                scenario_name   TEXT NOT NULL,
                scenario_path   TEXT NOT NULL,
                success         INTEGER NOT NULL,
                error           TEXT,
                steps_json      TEXT NOT NULL,
                duration_ms     INTEGER NOT NULL,
                timestamp       TEXT NOT NULL DEFAULT (
                    datetime('now')
                )
            );
            CREATE INDEX IF NOT EXISTS idx_run_history_ts
                ON run_history(timestamp DESC);",
        )
        .context("failed to initialize run_history table")?;
        Ok(())
    }

    /// Persist a completed run.
    pub fn save_run(
        &self,
        scenario_name: &str,
        scenario_path: &str,
        success: bool,
        error: Option<&str>,
        steps_json: &str,
        duration_ms: u64,
    ) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO run_history
                (scenario_name, scenario_path, success, error,
                 steps_json, duration_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                scenario_name,
                scenario_path,
                success as i32,
                error,
                steps_json,
                duration_ms as i64,
            ],
        )
        .context("failed to insert run")?;
        Ok(conn.last_insert_rowid())
    }

    /// Retrieve recent runs, most recent first.
    pub fn list_runs(
        &self,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<RunHistoryEntry>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, scenario_name, scenario_path, success,
                        error, steps_json, duration_ms, timestamp
                 FROM run_history
                 ORDER BY timestamp DESC
                 LIMIT ?1 OFFSET ?2",
            )
            .context("failed to prepare list query")?;

        let rows = stmt
            .query_map(
                rusqlite::params![limit, offset],
                |row| {
                    Ok(RunHistoryEntry {
                        id: row.get(0)?,
                        scenario_name: row.get(1)?,
                        scenario_path: row.get(2)?,
                        success: row.get::<_, i32>(3)? != 0,
                        error: row.get(4)?,
                        steps_json: row.get(5)?,
                        duration_ms: row.get::<_, i64>(6)? as u64,
                        timestamp: row.get(7)?,
                    })
                },
            )
            .context("failed to query runs")?;

        let mut entries = Vec::new();
        for row in rows {
            entries.push(row.context("failed to read row")?);
        }
        Ok(entries)
    }

    /// Retrieve a single run by ID.
    pub fn get_run(&self, id: i64) -> Result<Option<RunHistoryEntry>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, scenario_name, scenario_path, success,
                        error, steps_json, duration_ms, timestamp
                 FROM run_history
                 WHERE id = ?1",
            )
            .context("failed to prepare get query")?;

        let mut rows = stmt
            .query_map(rusqlite::params![id], |row| {
                Ok(RunHistoryEntry {
                    id: row.get(0)?,
                    scenario_name: row.get(1)?,
                    scenario_path: row.get(2)?,
                    success: row.get::<_, i32>(3)? != 0,
                    error: row.get(4)?,
                    steps_json: row.get(5)?,
                    duration_ms: row.get::<_, i64>(6)? as u64,
                    timestamp: row.get(7)?,
                })
            })
            .context("failed to query run")?;

        match rows.next() {
            Some(row) => Ok(Some(row.context("failed to read row")?)),
            None => Ok(None),
        }
    }
}
