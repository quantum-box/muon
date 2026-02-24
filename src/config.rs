//! TODO: add English documentation

use crate::model::TestScenario;
use anyhow::{Context, Result};
use std::fs;
use std::path::{Path, PathBuf};
use tracing::{debug, info};

/// TODO: add English documentation
#[derive(Debug)]
pub struct TestConfigManager {
    /// TODO: add English documentation
    pub test_paths: Vec<PathBuf>,
}

impl TestConfigManager {
    /// TODO: add English documentation
    pub fn new() -> Self {
        Self {
            test_paths: vec![PathBuf::from("tests/scenarios")],
        }
    }

    /// TODO: add English documentation
    pub fn add_path<P: AsRef<Path>>(&mut self, path: P) -> &mut Self {
        self.test_paths.push(path.as_ref().to_path_buf());
        self
    }

    /// Load a single scenario file.
    ///
    /// Dispatches to [`TestScenario::from_markdown`] for
    /// `.scenario.md` files and to [`TestScenario::from_yaml`]
    /// for `.yaml` / `.yml` files.
    pub fn load_scenario<P: AsRef<Path>>(
        &self,
        path: P,
    ) -> Result<TestScenario> {
        let path = path.as_ref();
        info!("Loading test scenario from {}", path.display());

        let content = fs::read_to_string(path).context(format!(
            "Failed to read test file: {}",
            path.display()
        ))?;

        let scenario = if is_markdown_scenario(path) {
            TestScenario::from_markdown(&content).context(format!(
                "Failed to parse Markdown scenario from {}",
                path.display()
            ))?
        } else if crate::runn_parser::is_runbook_file(path) {
            crate::runn_parser::parse_runbook(&content)
                .context(format!(
                    "Failed to parse runn runbook from {}",
                    path.display()
                ))?
        } else {
            TestScenario::from_yaml(&content).context(format!(
                "Failed to parse YAML from {}",
                path.display()
            ))?
        };

        debug!("Successfully loaded test scenario: {}", scenario.name);
        Ok(scenario)
    }

    /// TODO: add English documentation
    pub fn load_scenarios_from_dir<P: AsRef<Path>>(
        &self,
        dir: P,
    ) -> Result<Vec<TestScenario>> {
        let dir = dir.as_ref();
        info!("Loading test scenarios from directory: {}", dir.display());

        let mut scenarios = Vec::new();

        for entry in fs::read_dir(dir).context(format!(
            "Failed to read directory: {}",
            dir.display()
        ))? {
            let entry = entry?;
            let path = entry.path();

            if path.is_file() && is_scenario_file(&path) {
                match self.load_scenario(&path) {
                    Ok(scenario) => scenarios.push(scenario),
                    Err(err) => {
                        debug!(
                            "Failed to load scenario from {}: {}",
                            path.display(),
                            err
                        );
                    }
                }
            }
        }

        info!(
            "Loaded {} test scenarios from {}",
            scenarios.len(),
            dir.display()
        );
        Ok(scenarios)
    }

    /// TODO: add English documentation
    pub fn load_all_scenarios(&self) -> Result<Vec<TestScenario>> {
        let mut all_scenarios = Vec::new();

        for path in &self.test_paths {
            if path.exists() && path.is_dir() {
                match self.load_scenarios_from_dir(path) {
                    Ok(mut scenarios) => {
                        all_scenarios.append(&mut scenarios)
                    }
                    Err(err) => {
                        debug!(
                            "Failed to load scenarios from {}: {}",
                            path.display(),
                            err
                        );
                    }
                }
            }
        }

        info!("Loaded {} test scenarios in total", all_scenarios.len());
        Ok(all_scenarios)
    }
}

impl Default for TestConfigManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Return `true` if the file path looks like a scenario file
/// (`.yaml`, `.yml`, `.scenario.md`, or `.runbook.yml`).
fn is_scenario_file(path: &Path) -> bool {
    if is_markdown_scenario(path) {
        return true;
    }
    if crate::runn_parser::is_runbook_file(path) {
        return true;
    }
    path.extension()
        .is_some_and(|ext| ext == "yaml" || ext == "yml")
}

/// Return `true` when the path ends with `.scenario.md`.
fn is_markdown_scenario(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.ends_with(".scenario.md"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    // ── is_scenario_file ────────────────────────────────

    #[test]
    fn test_yaml_is_scenario_file() {
        assert!(is_scenario_file(Path::new("test.yaml")));
        assert!(is_scenario_file(Path::new("test.yml")));
        assert!(is_scenario_file(Path::new("dir/nested/foo.yaml")));
    }

    #[test]
    fn test_markdown_is_scenario_file() {
        assert!(is_scenario_file(Path::new("test.scenario.md")));
        assert!(is_scenario_file(Path::new("dir/nested/foo.scenario.md")));
    }

    #[test]
    fn test_non_scenario_files_rejected() {
        assert!(!is_scenario_file(Path::new("readme.md")));
        assert!(!is_scenario_file(Path::new("test.json")));
        assert!(!is_scenario_file(Path::new("test.toml")));
        assert!(!is_scenario_file(Path::new("test.txt")));
        assert!(!is_scenario_file(Path::new("no_ext")));
    }

    #[test]
    fn test_plain_md_not_scenario() {
        // .md alone should NOT be treated as scenario
        assert!(!is_scenario_file(Path::new("notes.md")));
        assert!(!is_scenario_file(Path::new("dir/README.md")));
    }

    // ── is_markdown_scenario ────────────────────────────

    #[test]
    fn test_markdown_scenario_detection() {
        assert!(is_markdown_scenario(Path::new("foo.scenario.md")));
        assert!(!is_markdown_scenario(Path::new("foo.yaml")));
        assert!(!is_markdown_scenario(Path::new("foo.md")));
        assert!(!is_markdown_scenario(Path::new("scenario.md.bak")));
    }

    // ── load_scenarios_from_dir (filesystem tests) ──────

    #[test]
    fn test_load_from_dir_with_mixed_formats() {
        let dir = tempdir_with_files(&[
            (
                "a.yaml",
                "name: yaml-test\nsteps:\n  - name: s\n    \
                 request:\n      method: GET\n      url: /t\n    \
                 expect:\n      status: 200\n",
            ),
            (
                "b.scenario.md",
                "---\nname: md-test\n---\n\n\
                 ```yaml scenario\nsteps:\n  - name: s\n    \
                 request:\n      method: GET\n      url: /t\n    \
                 expect:\n      status: 200\n```\n",
            ),
            ("c.json", "{\"ignored\": true}"),
            ("d.md", "# Not a scenario\n"),
        ]);

        let mgr = TestConfigManager::new();
        let scenarios = mgr.load_scenarios_from_dir(dir.path()).unwrap();

        assert_eq!(
            scenarios.len(),
            2,
            "Should load exactly yaml + scenario.md"
        );
        let names: Vec<&str> =
            scenarios.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"yaml-test"));
        assert!(names.contains(&"md-test"));
    }

    #[test]
    fn test_load_from_dir_ignores_plain_md() {
        let dir = tempdir_with_files(&[("readme.md", "# Just a readme\n")]);

        let mgr = TestConfigManager::new();
        let scenarios = mgr.load_scenarios_from_dir(dir.path()).unwrap();
        assert!(scenarios.is_empty(), "Plain .md should not be loaded");
    }

    // ── helper ──────────────────────────────────────────

    fn tempdir_with_files(files: &[(&str, &str)]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        for (name, content) in files {
            std::fs::write(dir.path().join(name), content).unwrap();
        }
        dir
    }
}
