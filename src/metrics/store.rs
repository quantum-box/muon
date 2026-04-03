//! In-memory storage for metrics and SLO definitions.

use super::model::{MonitoringMetric, MonitoringSlo};
use chrono::{Duration, Utc};
use std::collections::HashMap;
use tokio::sync::RwLock;

/// Thread-safe in-memory store for monitoring data.
pub struct MetricsStore {
    /// Metrics keyed by scenario_id, newest last.
    metrics: RwLock<HashMap<String, Vec<MonitoringMetric>>>,
    /// SLO definitions keyed by SLO id.
    slos: RwLock<HashMap<String, MonitoringSlo>>,
}

impl MetricsStore {
    pub fn new() -> Self {
        Self {
            metrics: RwLock::new(HashMap::new()),
            slos: RwLock::new(HashMap::new()),
        }
    }

    /// Record a new metric data point.
    pub async fn record_metric(&self, metric: MonitoringMetric) {
        let mut map = self.metrics.write().await;
        map.entry(metric.scenario_id.clone())
            .or_default()
            .push(metric);
    }

    /// Get all metrics for a scenario within a time window.
    pub async fn get_metrics_in_window(
        &self,
        scenario_id: &str,
        window_seconds: u64,
    ) -> Vec<MonitoringMetric> {
        let map = self.metrics.read().await;
        let cutoff = Utc::now() - Duration::seconds(window_seconds as i64);
        map.get(scenario_id)
            .map(|v| {
                v.iter()
                    .filter(|m| m.recorded_at >= cutoff)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Get all metrics grouped by scenario.
    pub async fn get_all_metrics(
        &self,
    ) -> HashMap<String, Vec<MonitoringMetric>> {
        self.metrics.read().await.clone()
    }

    /// Register or update an SLO definition.
    pub async fn upsert_slo(&self, slo: MonitoringSlo) {
        self.slos.write().await.insert(slo.id.clone(), slo);
    }

    /// Remove an SLO definition.
    pub async fn delete_slo(&self, slo_id: &str) -> bool {
        self.slos.write().await.remove(slo_id).is_some()
    }

    /// Get all SLO definitions.
    pub async fn get_all_slos(&self) -> Vec<MonitoringSlo> {
        self.slos.read().await.values().cloned().collect()
    }

    /// Get SLOs for a specific scenario.
    pub async fn get_slos_for_scenario(
        &self,
        scenario_id: &str,
    ) -> Vec<MonitoringSlo> {
        self.slos
            .read()
            .await
            .values()
            .filter(|s| s.scenario_id == scenario_id)
            .cloned()
            .collect()
    }
}
