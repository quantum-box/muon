//! TODO: add English documentation

use crate::model::TestScenario;
use anyhow::{Context, Result};
use std::fs;
use std::path::{Path, PathBuf};
use tracing::{debug, info, warn};

/// Environment variable that promotes scenario parse errors
/// to hard failures (see
/// [`TestConfigManager::fail_on_parse_error`]).
pub const FAIL_ON_PARSE_ERROR_ENV: &str = "MUON_FAIL_ON_PARSE_ERROR";

/// Read [`FAIL_ON_PARSE_ERROR_ENV`] and interpret it as a
/// boolean (`1` / `true` / `yes`, case-insensitive).
fn env_fail_on_parse_error() -> bool {
    std::env::var(FAIL_ON_PARSE_ERROR_ENV)
        .is_ok_and(|v| parse_bool_flag(&v))
}

/// Interpret an environment variable value as a boolean flag
/// (`1` / `true` / `yes`, case-insensitive).
fn parse_bool_flag(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes"
    )
}

/// TODO: add English documentation
#[derive(Debug)]
pub struct TestConfigManager {
    /// TODO: add English documentation
    pub test_paths: Vec<PathBuf>,
    /// When `true`, a scenario file that fails to parse aborts
    /// loading with an error instead of being skipped with a
    /// warning. Defaults to the `MUON_FAIL_ON_PARSE_ERROR`
    /// environment variable.
    pub fail_on_parse_error: bool,
}

impl TestConfigManager {
    /// TODO: add English documentation
    pub fn new() -> Self {
        Self {
            test_paths: vec![PathBuf::from("tests/scenarios")],
            fail_on_parse_error: env_fail_on_parse_error(),
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
            crate::runn_parser::parse_runbook(&content).context(format!(
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

    /// Load every scenario file found directly in `dir`.
    ///
    /// Files that fail to parse are skipped with a `warn!`
    /// log unless [`Self::fail_on_parse_error`] is set, in
    /// which case the first parse failure is returned as an
    /// error.
    pub fn load_scenarios_from_dir<P: AsRef<Path>>(
        &self,
        dir: P,
    ) -> Result<Vec<TestScenario>> {
        let (scenarios, _skipped) =
            self.load_scenarios_from_dir_counted(dir.as_ref())?;
        Ok(scenarios)
    }

    /// Like [`Self::load_scenarios_from_dir`] but also returns
    /// how many scenario files were skipped due to parse
    /// errors.
    fn load_scenarios_from_dir_counted(
        &self,
        dir: &Path,
    ) -> Result<(Vec<TestScenario>, usize)> {
        info!("Loading test scenarios from directory: {}", dir.display());

        let mut scenarios = Vec::new();
        let mut skipped = 0usize;

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
                        if self.fail_on_parse_error {
                            return Err(err.context(format!(
                                "Failed to load scenario from {} \
                                 ({FAIL_ON_PARSE_ERROR_ENV} is \
                                 enabled)",
                                path.display()
                            )));
                        }
                        warn!(
                            "Skipping scenario {}: {:#}",
                            path.display(),
                            err
                        );
                        skipped += 1;
                    }
                }
            }
        }

        info!(
            "Loaded {} test scenarios from {} / skipped {} \
             (parse errors)",
            scenarios.len(),
            dir.display(),
            skipped
        );
        Ok((scenarios, skipped))
    }

    /// Load scenarios from every registered test path.
    ///
    /// Directory-level and parse errors are skipped with a
    /// `warn!` log unless [`Self::fail_on_parse_error`] is
    /// set, in which case the first failure is returned as an
    /// error.
    pub fn load_all_scenarios(&self) -> Result<Vec<TestScenario>> {
        let mut all_scenarios = Vec::new();
        let mut total_skipped = 0usize;

        for path in &self.test_paths {
            if path.exists() && path.is_dir() {
                match self.load_scenarios_from_dir_counted(path) {
                    Ok((mut scenarios, skipped)) => {
                        all_scenarios.append(&mut scenarios);
                        total_skipped += skipped;
                    }
                    Err(err) => {
                        if self.fail_on_parse_error {
                            return Err(err);
                        }
                        warn!(
                            "Failed to load scenarios from {}: {:#}",
                            path.display(),
                            err
                        );
                    }
                }
            }
        }

        info!(
            "Loaded {} test scenarios in total / skipped {} \
             (parse errors)",
            all_scenarios.len(),
            total_skipped
        );
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

    #[test]
    fn test_load_from_dir_skips_broken_scenarios_by_default() {
        let dir = tempdir_with_files(&[
            (
                "ok.yaml",
                "name: ok-test\nsteps:\n  - name: s\n    \
                 request:\n      method: GET\n      url: /t\n    \
                 expect:\n      status: 200\n",
            ),
            ("broken.yaml", "name: [unclosed\n"),
            (
                "broken.scenario.md",
                "---\nname: broken-md\n---\n\n\
                 ```yaml scenario\nsteps: [unclosed\n```\n",
            ),
        ]);

        let mut mgr = TestConfigManager::new();
        mgr.fail_on_parse_error = false;
        let scenarios = mgr.load_scenarios_from_dir(dir.path()).unwrap();

        assert_eq!(
            scenarios.len(),
            1,
            "Broken scenarios should be skipped, valid ones kept"
        );
        assert_eq!(scenarios[0].name, "ok-test");
    }

    #[test]
    fn test_load_from_dir_fails_on_parse_error_when_enabled() {
        let dir =
            tempdir_with_files(&[("broken.yaml", "name: [unclosed\n")]);

        let mut mgr = TestConfigManager::new();
        mgr.fail_on_parse_error = true;
        let err = mgr
            .load_scenarios_from_dir(dir.path())
            .expect_err("parse error should abort loading");

        let message = format!("{err:#}");
        assert!(
            message.contains("broken.yaml"),
            "error should name the failing file: {message}"
        );
    }

    #[test]
    fn test_load_all_scenarios_fails_on_parse_error_when_enabled() {
        let dir =
            tempdir_with_files(&[("broken.yaml", "name: [unclosed\n")]);

        let mut mgr = TestConfigManager::new();
        mgr.test_paths = vec![dir.path().to_path_buf()];
        mgr.fail_on_parse_error = true;
        assert!(mgr.load_all_scenarios().is_err());

        mgr.fail_on_parse_error = false;
        let scenarios = mgr.load_all_scenarios().unwrap();
        assert!(scenarios.is_empty());
    }

    // ── parse_bool_flag ─────────────────────────────────

    #[test]
    fn test_parse_bool_flag() {
        assert!(parse_bool_flag("1"));
        assert!(parse_bool_flag("true"));
        assert!(parse_bool_flag("TRUE"));
        assert!(parse_bool_flag(" yes "));
        assert!(!parse_bool_flag("0"));
        assert!(!parse_bool_flag("false"));
        assert!(!parse_bool_flag(""));
        assert!(!parse_bool_flag("enabled"));
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
