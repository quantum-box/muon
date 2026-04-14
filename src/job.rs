//! Job model for distributed worker queue.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Status of a distributed job.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Pending,
    Running,
    Success,
    Failed,
}

/// A distributed scenario execution job.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    pub job_id: String,
    pub tenant_id: String,
    pub scenario_path: String,
    pub region: String,
    pub created_at: DateTime<Utc>,
}

impl Job {
    pub fn new(
        tenant_id: impl Into<String>,
        scenario_path: impl Into<String>,
        region: impl Into<String>,
    ) -> Self {
        Self {
            job_id: Uuid::new_v4().to_string(),
            tenant_id: tenant_id.into(),
            scenario_path: scenario_path.into(),
            region: region.into(),
            created_at: Utc::now(),
        }
    }
}

/// Result of a distributed scenario execution job.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobResult {
    pub job_id: String,
    pub tenant_id: String,
    pub region: String,
    pub status: JobStatus,
    pub duration_ms: Option<u64>,
    pub error: Option<String>,
    pub completed_at: Option<DateTime<Utc>>,
}

impl JobResult {
    pub fn pending(job: &Job) -> Self {
        Self {
            job_id: job.job_id.clone(),
            tenant_id: job.tenant_id.clone(),
            region: job.region.clone(),
            status: JobStatus::Pending,
            duration_ms: None,
            error: None,
            completed_at: None,
        }
    }

    pub fn success(job: &Job, duration_ms: u64) -> Self {
        Self {
            job_id: job.job_id.clone(),
            tenant_id: job.tenant_id.clone(),
            region: job.region.clone(),
            status: JobStatus::Success,
            duration_ms: Some(duration_ms),
            error: None,
            completed_at: Some(Utc::now()),
        }
    }

    pub fn failed(
        job: &Job,
        error: impl Into<String>,
        duration_ms: u64,
    ) -> Self {
        Self {
            job_id: job.job_id.clone(),
            tenant_id: job.tenant_id.clone(),
            region: job.region.clone(),
            status: JobStatus::Failed,
            duration_ms: Some(duration_ms),
            error: Some(error.into()),
            completed_at: Some(Utc::now()),
        }
    }
}
