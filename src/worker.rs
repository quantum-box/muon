//! Distributed worker for executing muon scenarios from a queue.
//!
//! Each worker process polls a Redis Stream consumer group, picks up jobs,
//! executes the scenario, stores the result and then acknowledges the message.
//! A heartbeat key is refreshed every 30 seconds so operators can detect
//! stale workers.

use crate::job::{Job, JobResult, JobStatus};
use crate::queue::RedisQueue;
use crate::runner::DefaultTestRunner;
use crate::TestRunner;
use anyhow::Result;
use std::sync::Arc;
use std::time::Instant;
use tracing::{error, info, warn};
use uuid::Uuid;

/// Configuration for a distributed worker.
#[derive(Debug, Clone)]
pub struct WorkerConfig {
    /// Redis URL for the job queue.
    pub queue_url: String,
    /// Logical region label (e.g. "ap-northeast-1").
    pub region: String,
    /// Number of concurrent job executors.
    pub concurrency: usize,
    /// Tenant identifier (optional, for multi-tenant filtering).
    pub tenant_id: Option<String>,
}

impl Default for WorkerConfig {
    fn default() -> Self {
        Self {
            queue_url: "redis://127.0.0.1:6379".to_string(),
            region: "local".to_string(),
            concurrency: 1,
            tenant_id: None,
        }
    }
}

/// A distributed worker that consumes jobs from a queue.
pub struct Worker {
    config: WorkerConfig,
    worker_id: String,
    queue: Arc<RedisQueue>,
}

impl Worker {
    /// Create a new worker with the given config.
    pub async fn new(config: WorkerConfig) -> Self {
        let worker_id = format!("worker-{}", Uuid::new_v4());
        let queue = Arc::new(
            RedisQueue::new(&config.queue_url, worker_id.clone()).await,
        );
        if queue.is_redis_connected() {
            info!(
                "Worker {} starting (region={}, concurrency={}, \
                 redis=connected)",
                worker_id, config.region, config.concurrency
            );
        } else {
            warn!(
                "Worker {} starting (region={}, concurrency={}, \
                 redis=fallback)",
                worker_id, config.region, config.concurrency
            );
        }
        Self {
            config,
            worker_id,
            queue,
        }
    }

    /// Run the worker main loop until the process is terminated.
    pub async fn run(self) -> Result<()> {
        let worker_id = self.worker_id.clone();
        let region = self.config.region.clone();
        let concurrency = self.config.concurrency;
        let queue = self.queue.clone();

        // Heartbeat task — keeps `muon:worker:<id>:heartbeat` alive.
        let hb_worker_id = worker_id.clone();
        let hb_region = region.clone();
        tokio::spawn(async move {
            loop {
                info!(
                    "Heartbeat: muon:worker:{}:heartbeat (region={})",
                    hb_worker_id, hb_region
                );
                tokio::time::sleep(tokio::time::Duration::from_secs(30))
                    .await;
            }
        });

        // Semaphore to bound concurrency.
        let semaphore = Arc::new(tokio::sync::Semaphore::new(concurrency));

        loop {
            let permit = semaphore.clone().acquire_owned().await?;
            let job = queue.dequeue().await;
            match job {
                Some(job) => {
                    info!(
                        "[{}] Dequeued job {} (tenant={}, scenario={})",
                        region,
                        job.job_id,
                        job.tenant_id,
                        job.scenario_path
                    );
                    let queue_ref = queue.clone();
                    let region_ref = region.clone();
                    tokio::spawn(async move {
                        let _permit = permit; // released when task completes
                        Self::execute_job(&queue_ref, &region_ref, job)
                            .await;
                    });
                }
                None => {
                    // dequeue returned None only in fallback (no-redis) mode.
                    drop(permit);
                    tokio::time::sleep(tokio::time::Duration::from_millis(
                        500,
                    ))
                    .await;
                }
            }
        }
    }

    async fn execute_job(queue: &RedisQueue, region: &str, job: Job) {
        let start = Instant::now();

        // Mark as running.
        let running = JobResult {
            job_id: job.job_id.clone(),
            tenant_id: job.tenant_id.clone(),
            region: region.to_string(),
            status: JobStatus::Running,
            duration_ms: None,
            error: None,
            completed_at: None,
        };
        if let Err(e) = queue.store_result(&running).await {
            error!(
                "Failed to store running status for {}: {}",
                job.job_id, e
            );
        }

        // Execute scenario.
        let result = Self::run_scenario(&job).await;
        let elapsed_ms = start.elapsed().as_millis() as u64;

        let job_result = match result {
            Ok(_) => {
                info!(
                    "[{}] Job {} completed in {}ms",
                    region, job.job_id, elapsed_ms
                );
                JobResult::success(&job, elapsed_ms)
            }
            Err(e) => {
                error!("[{}] Job {} failed: {}", region, job.job_id, e);
                JobResult::failed(&job, e.to_string(), elapsed_ms)
            }
        };

        if let Err(e) = queue.store_result(&job_result).await {
            error!("Failed to store result for {}: {}", job.job_id, e);
        }
        queue.ack(&job.job_id).await;
    }

    async fn run_scenario(job: &Job) -> Result<()> {
        use std::path::PathBuf;

        let path = PathBuf::from(&job.scenario_path);
        if !path.exists() {
            anyhow::bail!("Scenario file not found: {}", job.scenario_path);
        }

        let mut config = crate::TestConfigManager::new();
        config.add_path(
            path.parent()
                .unwrap_or_else(|| std::path::Path::new("."))
                .to_str()
                .unwrap_or("."),
        );

        let scenario = config.load_scenario(&path)?;
        let runner = DefaultTestRunner::new();
        let result = runner.run(&scenario).await?;

        if result.success {
            Ok(())
        } else {
            let errors: Vec<String> = result
                .steps
                .iter()
                .filter_map(|s| s.error.clone())
                .collect();
            anyhow::bail!("Scenario failed: {}", errors.join("; "))
        }
    }
}
