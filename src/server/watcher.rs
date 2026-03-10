//! File system watcher for auto-reloading scenarios on change.

use crate::server::state::AppState;
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::sync::Arc;
use tracing::{debug, error, info};

/// Start watching the scenario directory for file changes.
///
/// When a change is detected, scenarios are reloaded into
/// [`AppState`] and connected clients are notified via the
/// broadcast channel.
pub async fn start_watcher(
    state: Arc<AppState>,
) -> anyhow::Result<RecommendedWatcher> {
    let state_clone = state.clone();

    let mut watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| match res {
            Ok(event) => {
                debug!("File change detected: {:?}", event);
                let state = state_clone.clone();
                // Spawn a task to reload scenarios
                // asynchronously
                tokio::spawn(async move {
                    state.reload_scenarios().await;
                    let _ = state.change_tx.send(());
                });
            }
            Err(e) => {
                error!("File watcher error: {}", e);
            }
        },
        notify::Config::default(),
    )?;

    watcher.watch(state.scenario_dir.as_ref(), RecursiveMode::Recursive)?;

    info!("Watching {} for changes", state.scenario_dir.display());

    Ok(watcher)
}
