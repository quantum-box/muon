//! Redis Stream-based job queue for distributed worker coordination.
//!
//! Uses Redis Consumer Groups for reliable message delivery. When Redis
//! is unavailable the queue falls back to a simple in-memory channel so
//! the rest of the system can still operate without a Redis dependency.

use crate::job::{Job, JobResult};
use anyhow::Result;
use redis::aio::MultiplexedConnection;
use redis::{AsyncCommands, Client};
use std::collections::HashMap;
use tokio::sync::Mutex;
use tracing::{debug, error, warn};

const STREAM_KEY: &str = "muon:jobs";
const RESULTS_KEY_PREFIX: &str = "muon:results:";
const CONSUMER_GROUP: &str = "muon-workers";
const CONSUMER_TTL_SECS: u64 = 300;

/// A Redis Stream-backed job queue with in-memory fallback.
pub struct RedisQueue {
    client: Option<Client>,
    connection: Mutex<Option<MultiplexedConnection>>,
    /// In-memory fallback used when Redis is unavailable.
    fallback: Mutex<std::collections::VecDeque<Job>>,
    fallback_results: Mutex<HashMap<String, JobResult>>,
    consumer_name: String,
}

impl RedisQueue {
    /// Create a new queue, attempting to connect to the given Redis URL.
    /// If connection fails the queue operates in fallback (in-memory) mode.
    pub async fn new(
        queue_url: &str,
        consumer_name: impl Into<String>,
    ) -> Self {
        let consumer_name = consumer_name.into();
        match Client::open(queue_url) {
            Ok(client) => {
                match client.get_multiplexed_async_connection().await {
                    Ok(conn) => {
                        debug!("Connected to Redis at {}", queue_url);
                        Self {
                            client: Some(client),
                            connection: Mutex::new(Some(conn)),
                            fallback: Mutex::new(
                                std::collections::VecDeque::new(),
                            ),
                            fallback_results: Mutex::new(HashMap::new()),
                            consumer_name,
                        }
                    }
                    Err(e) => {
                        warn!(
                            "Failed to connect to Redis ({}), using \
                             in-memory fallback",
                            e
                        );
                        Self::fallback_queue(consumer_name)
                    }
                }
            }
            Err(e) => {
                warn!(
                    "Invalid Redis URL ({}), using in-memory fallback",
                    e
                );
                Self::fallback_queue(consumer_name)
            }
        }
    }

    fn fallback_queue(consumer_name: String) -> Self {
        Self {
            client: None,
            connection: Mutex::new(None),
            fallback: Mutex::new(std::collections::VecDeque::new()),
            fallback_results: Mutex::new(HashMap::new()),
            consumer_name,
        }
    }

    /// Whether this queue is backed by a live Redis connection.
    pub fn is_redis_connected(&self) -> bool {
        self.client.is_some()
    }

    /// Enqueue a job and return its ID.
    pub async fn enqueue(&self, job: &Job) -> Result<String> {
        if let Some(conn) = &mut *self.connection.lock().await {
            // Ensure consumer group exists (ignore error if already exists).
            let _: Result<(), _> = redis::cmd("XGROUP")
                .arg("CREATE")
                .arg(STREAM_KEY)
                .arg(CONSUMER_GROUP)
                .arg("0")
                .arg("MKSTREAM")
                .query_async(conn)
                .await;

            let job_json = serde_json::to_string(job)?;
            let _id: String =
                conn.xadd(STREAM_KEY, "*", &[("job", job_json)]).await?;

            // Store initial pending result.
            let result = JobResult::pending(job);
            let result_json = serde_json::to_string(&result)?;
            let results_key =
                format!("{}{}", RESULTS_KEY_PREFIX, job.job_id);
            conn.set_ex::<_, _, ()>(
                &results_key,
                result_json,
                CONSUMER_TTL_SECS,
            )
            .await?;

            debug!("Enqueued job {} to Redis stream", job.job_id);
        } else {
            self.fallback.lock().await.push_back(job.clone());
            self.fallback_results
                .lock()
                .await
                .insert(job.job_id.clone(), JobResult::pending(job));
            debug!("Enqueued job {} to in-memory fallback", job.job_id);
        }

        Ok(job.job_id.clone())
    }

    /// Dequeue the next available job via consumer group (blocking).
    ///
    /// Returns `None` only when operating in fallback mode and the queue
    /// is empty.
    pub async fn dequeue(&self) -> Option<Job> {
        if let Some(conn) = &mut *self.connection.lock().await {
            let result: redis::RedisResult<
                redis::streams::StreamReadReply,
            > = redis::cmd("XREADGROUP")
                .arg("GROUP")
                .arg(CONSUMER_GROUP)
                .arg(&self.consumer_name)
                .arg("COUNT")
                .arg(1)
                .arg("BLOCK")
                .arg(0)
                .arg("STREAMS")
                .arg(STREAM_KEY)
                .arg(">")
                .query_async(conn)
                .await;

            match result {
                Ok(reply) => {
                    for stream_key in reply.keys {
                        for entry in stream_key.ids {
                            if let Some(job_val) = entry.map.get("job") {
                                let job_str = match job_val {
                                    redis::Value::Data(bytes) => {
                                        String::from_utf8_lossy(bytes)
                                            .to_string()
                                    }
                                    redis::Value::Status(s) => s.clone(),
                                    _ => {
                                        error!(
                                            "Unexpected Redis value type \
                                             for job field"
                                        );
                                        continue;
                                    }
                                };
                                match serde_json::from_str::<Job>(&job_str)
                                {
                                    Ok(job) => return Some(job),
                                    Err(e) => {
                                        error!(
                                            "Failed to deserialize job: {}",
                                            e
                                        );
                                    }
                                }
                            }
                        }
                    }
                    None
                }
                Err(e) => {
                    error!("Failed to read from Redis stream: {}", e);
                    None
                }
            }
        } else {
            self.fallback.lock().await.pop_front()
        }
    }

    /// Acknowledge a job as processed.
    pub async fn ack(&self, job_id: &str) {
        if let Some(conn) = &mut *self.connection.lock().await {
            let result: redis::RedisResult<redis::Value> =
                redis::cmd("XACK")
                    .arg(STREAM_KEY)
                    .arg(CONSUMER_GROUP)
                    .arg(job_id)
                    .query_async(conn)
                    .await;
            if let Err(e) = result {
                debug!("XACK for {} returned: {}", job_id, e);
            }
        }
        // In-memory fallback: nothing to ack.
    }

    /// Store a job result (overwrites any existing result for the same
    /// job ID).
    pub async fn store_result(&self, result: &JobResult) -> Result<()> {
        if let Some(conn) = &mut *self.connection.lock().await {
            let result_json = serde_json::to_string(result)?;
            let results_key =
                format!("{}{}", RESULTS_KEY_PREFIX, result.job_id);
            conn.set_ex::<_, _, ()>(
                &results_key,
                result_json,
                CONSUMER_TTL_SECS,
            )
            .await?;
        } else {
            self.fallback_results
                .lock()
                .await
                .insert(result.job_id.clone(), result.clone());
        }
        Ok(())
    }

    /// Retrieve a job result by ID.
    pub async fn get_result(&self, job_id: &str) -> Option<JobResult> {
        if let Some(conn) = &mut *self.connection.lock().await {
            let results_key = format!("{}{}", RESULTS_KEY_PREFIX, job_id);
            let result: redis::RedisResult<String> =
                conn.get(&results_key).await;
            match result {
                Ok(json) => serde_json::from_str(&json).ok(),
                Err(_) => None,
            }
        } else {
            self.fallback_results.lock().await.get(job_id).cloned()
        }
    }
}
