/// Markdown scenario file parser.
///
/// Parses `.scenario.md` files that contain a YAML front matter
/// block and one or more ` ```yaml scenario ` fenced code blocks.
/// The front matter supplies top-level fields (`name`, `description`,
/// `vars`, `config`) and each code block contributes `steps`.
///
/// # Format
///
/// ````markdown
/// ---
/// name: "my scenario"
/// description: "..."
/// vars:
///   key: value
/// config:
///   timeout: 30
/// ---
///
/// # Heading (ignored by parser)
///
/// Free-form explanation text.
///
/// ```yaml scenario
/// steps:
///   - id: step1
///     name: do something
///     ...
/// ```
/// ````
use std::collections::HashMap;

use anyhow::{bail, Context, Result};
use serde::Deserialize;

use crate::model::{TestConfig, TestScenario, TestStep};

/// Intermediate representation for the YAML front matter.
#[derive(Debug, Deserialize)]
struct FrontMatter {
    name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    vars: HashMap<String, serde_json::Value>,
    #[serde(default)]
    config: TestConfig,
    #[serde(default)]
    #[allow(dead_code)]
    tags: Vec<String>,
}

/// Intermediate struct for code-block content.
///
/// A block may contain `steps`, `config`, or both.
/// When `config` appears in a code block it is merged into the
/// scenario-level config (code-block values win over front matter).
#[derive(Debug, Deserialize)]
struct ScenarioBlock {
    #[serde(default)]
    steps: Vec<TestStep>,
    #[serde(default)]
    config: Option<MergeableConfig>,
}

/// Config struct for code blocks where all fields are optional.
///
/// This allows distinguishing between "field was absent" (`None`)
/// and "field was explicitly set" (`Some(value)`), even when the
/// explicit value equals the default.
#[derive(Debug, Deserialize)]
struct MergeableConfig {
    #[serde(default)]
    base_url: Option<String>,
    #[serde(default)]
    headers: Option<HashMap<String, String>>,
    #[serde(default)]
    timeout: Option<u64>,
    #[serde(default)]
    continue_on_failure: Option<bool>,
}

/// A parsed fenced code block together with its starting
/// line number (1-based) so that error messages can reference
/// the source location.
#[derive(Debug)]
struct CodeBlock {
    /// 1-based line number where the opening fence appears.
    line: usize,
    /// Raw content between the fences.
    content: String,
}

/// Parse a Markdown scenario file into a [`TestScenario`].
pub fn parse_markdown_scenario(input: &str) -> Result<TestScenario> {
    let (front_matter, _body_start_line) =
        parse_front_matter(input).context("Failed to parse front matter")?;

    let fm: FrontMatter = serde_yaml::from_str(&front_matter)
        .context("Failed to deserialize front matter as YAML")?;

    let blocks = extract_scenario_code_blocks(input)?;

    if blocks.is_empty() {
        bail!("No ```yaml scenario code blocks found in Markdown file");
    }

    let mut all_steps: Vec<TestStep> = Vec::new();
    let mut merged_config = fm.config;

    for block in &blocks {
        let parsed: ScenarioBlock = serde_yaml::from_str(&block.content).with_context(|| {
            format!("Failed to parse YAML scenario block at line {}", block.line)
        })?;
        all_steps.extend(parsed.steps);

        // Merge config from code blocks (last writer wins).
        if let Some(cfg) = parsed.config {
            merge_config(&mut merged_config, &cfg);
        }
    }

    Ok(TestScenario {
        name: fm.name,
        description: fm.description,
        steps: all_steps,
        vars: fm.vars,
        config: merged_config,
    })
}

// -----------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------

/// Merge `src` config into `dst`.
///
/// Only fields that were explicitly present in the code block
/// (`Some(…)`) overwrite `dst`; absent fields (`None`) are
/// left untouched.  Headers are merged key-by-key.
fn merge_config(dst: &mut TestConfig, src: &MergeableConfig) {
    if let Some(ref base_url) = src.base_url {
        dst.base_url = Some(base_url.clone());
    }
    if let Some(ref headers) = src.headers {
        for (k, v) in headers {
            dst.headers.insert(k.clone(), v.clone());
        }
    }
    if let Some(timeout) = src.timeout {
        dst.timeout = timeout;
    }
    if let Some(continue_on_failure) = src.continue_on_failure {
        dst.continue_on_failure = continue_on_failure;
    }
}

/// Extract YAML front matter enclosed between `---` delimiters.
/// Returns the raw YAML string and the 1-based line number
/// where the body starts (i.e. the line after the closing `---`).
fn parse_front_matter(input: &str) -> Result<(String, usize)> {
    let mut lines = input.lines().enumerate();

    // The very first line must be `---`.
    match lines.next() {
        Some((_idx, line)) if line.trim() == "---" => {}
        _ => bail!("Markdown front matter must start with '---'"),
    }

    let mut fm_lines: Vec<&str> = Vec::new();
    for (idx, line) in lines {
        if line.trim() == "---" {
            // idx is 0-based; body starts at the next line.
            return Ok((fm_lines.join("\n"), idx + 2));
        }
        fm_lines.push(line);
    }

    bail!("Closing '---' for front matter not found")
}

/// Scan the Markdown for fenced code blocks whose info string
/// starts with `yaml scenario` (case-insensitive on the keyword
/// `scenario`).  Returns blocks in document order.
///
/// Returns an error if a scenario fence is opened but never
/// closed before the end of the file.
fn extract_scenario_code_blocks(input: &str) -> Result<Vec<CodeBlock>> {
    let mut blocks = Vec::new();
    let mut in_block = false;
    let mut current_line: usize = 0;
    let mut current_content: Vec<&str> = Vec::new();

    for (idx, line) in input.lines().enumerate() {
        let trimmed = line.trim();
        if !in_block {
            if is_scenario_fence_open(trimmed) {
                in_block = true;
                current_line = idx + 1; // 1-based
                current_content.clear();
            }
        } else if trimmed == "```" {
            blocks.push(CodeBlock {
                line: current_line,
                content: current_content.join("\n"),
            });
            in_block = false;
        } else {
            current_content.push(line);
        }
    }

    if in_block {
        bail!(
            "Unterminated ```yaml scenario block starting at \
             line {current_line}"
        );
    }

    Ok(blocks)
}

/// Detect whether a trimmed line is an opening fence for a
/// scenario block.  Accepted patterns:
///   ```yaml scenario
///   ```yaml Scenario
///   ``` yaml scenario        (spaces after ```)
fn is_scenario_fence_open(trimmed: &str) -> bool {
    if !trimmed.starts_with("```") {
        return false;
    }
    let info = trimmed[3..].trim().to_ascii_lowercase();
    info == "yaml scenario"
}

// -----------------------------------------------------------
// Tests
// -----------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"---
name: "sample scenario"
description: "A sample"
vars:
  operator_id: tn_test
config:
  timeout: 10
---

# Sample Scenario

This text is ignored by the parser.

```yaml scenario
steps:
  - id: step1
    name: create something
    request:
      method: POST
      url: /v1/test
      body:
        key: value
    expect:
      status: 201
```

Some more explanation.

```yaml scenario
steps:
  - id: step2
    name: get something
    request:
      method: GET
      url: /v1/test/{{steps.step1.outputs.id}}
    expect:
      status: 200
```
"#;

    #[test]
    fn test_parse_front_matter() {
        let (fm, body_line) = parse_front_matter(SAMPLE).unwrap();
        assert!(fm.contains("name:"));
        assert!(fm.contains("operator_id"));
        assert!(body_line > 1);
    }

    #[test]
    fn test_extract_code_blocks() {
        let blocks = extract_scenario_code_blocks(SAMPLE).unwrap();
        assert_eq!(blocks.len(), 2);
        assert!(blocks[0].content.contains("step1"));
        assert!(blocks[1].content.contains("step2"));
    }

    #[test]
    fn test_full_parse() {
        let scenario = parse_markdown_scenario(SAMPLE).unwrap();
        assert_eq!(scenario.name, "sample scenario");
        assert_eq!(scenario.description.as_deref(), Some("A sample"));
        assert_eq!(scenario.steps.len(), 2);
        assert_eq!(scenario.steps[0].id.as_deref(), Some("step1"));
        assert_eq!(scenario.steps[1].id.as_deref(), Some("step2"));
        assert_eq!(scenario.config.timeout, 10);
        assert_eq!(scenario.vars.get("operator_id").unwrap(), "tn_test");
    }

    #[test]
    fn test_missing_front_matter() {
        let input = "# No front matter\n\nSome text\n";
        let err = parse_markdown_scenario(input);
        assert!(err.is_err());
    }

    #[test]
    fn test_no_code_blocks() {
        let input = "---\nname: test\n---\n\nNo blocks here.\n";
        let err = parse_markdown_scenario(input);
        assert!(err.is_err());
    }

    #[test]
    fn test_non_scenario_code_blocks_ignored() {
        let input = r#"---
name: test
---

```yaml
not_a_scenario: true
```

```yaml scenario
steps:
  - id: s1
    name: only this
    request:
      method: GET
      url: /test
    expect:
      status: 200
```
"#;
        let scenario = parse_markdown_scenario(input).unwrap();
        assert_eq!(scenario.steps.len(), 1);
        assert_eq!(scenario.steps[0].id.as_deref(), Some("s1"));
    }

    #[test]
    fn test_config_in_code_block() {
        let input = r#"---
name: config-in-block
vars:
  op: tn_test
---

```yaml scenario
config:
  headers:
    Authorization: Bearer dummy
    Content-Type: application/json
  timeout: 60
```

```yaml scenario
steps:
  - id: s1
    name: test
    request:
      method: GET
      url: /test
    expect:
      status: 200
```
"#;
        let scenario = parse_markdown_scenario(input).unwrap();
        assert_eq!(scenario.config.timeout, 60);
        assert_eq!(
            scenario.config.headers.get("Authorization").unwrap(),
            "Bearer dummy"
        );
        assert_eq!(scenario.steps.len(), 1);
    }

    #[test]
    fn test_error_includes_line_number() {
        let input = r#"---
name: test
---

```yaml scenario
invalid: yaml: content: [
```
"#;
        let err = parse_markdown_scenario(input).unwrap_err().to_string();
        assert!(err.contains("line"), "Error should reference line: {err}");
    }

    #[test]
    fn test_code_block_overrides_timeout_to_default() {
        // Front matter sets timeout: 10; code block explicitly
        // sets timeout: 30 (the default).  The code-block value
        // must win.
        let input = r#"---
name: override-to-default
config:
  timeout: 10
  continue_on_failure: true
---

```yaml scenario
config:
  timeout: 30
  continue_on_failure: false
steps:
  - id: s1
    name: test
    request:
      method: GET
      url: /test
    expect:
      status: 200
```
"#;
        let scenario = parse_markdown_scenario(input).unwrap();
        assert_eq!(
            scenario.config.timeout, 30,
            "Code-block timeout: 30 should override front matter \
             timeout: 10"
        );
        assert!(
            !scenario.config.continue_on_failure,
            "Code-block continue_on_failure: false should override \
             front matter true"
        );
    }

    // ── RED tests ───────────────────────────────────────

    #[test]
    fn test_front_matter_unclosed() {
        let input = "---\nname: test\nno closing delimiter\n";
        let err = parse_markdown_scenario(input);
        assert!(
            err.is_err(),
            "Should fail when front matter closing '---' is missing"
        );
    }

    #[test]
    fn test_front_matter_missing_name() {
        // `name` is a required field in FrontMatter.
        let input = r#"---
description: "no name field"
---

```yaml scenario
steps:
  - id: s1
    name: step
    request:
      method: GET
      url: /test
    expect:
      status: 200
```
"#;
        let err = parse_markdown_scenario(input);
        assert!(err.is_err(), "Should fail when required 'name' is missing");
    }

    #[test]
    fn test_front_matter_invalid_yaml() {
        let input = "---\n[invalid yaml: {{{\n---\n";
        let err = parse_markdown_scenario(input);
        assert!(err.is_err(), "Should fail on invalid YAML in front matter");
    }

    #[test]
    fn test_empty_file() {
        let err = parse_markdown_scenario("");
        assert!(err.is_err(), "Empty input should fail");
    }

    #[test]
    fn test_code_block_with_invalid_step_structure() {
        // steps items missing required fields (request, expect)
        let input = r#"---
name: bad steps
---

```yaml scenario
steps:
  - id: s1
    name: missing request and expect
```
"#;
        let err = parse_markdown_scenario(input);
        assert!(
            err.is_err(),
            "Should fail when step is missing required fields"
        );
    }

    #[test]
    fn test_unclosed_code_block_error() {
        // A code block that is never closed must produce an
        // explicit error, not be silently dropped.
        let input = r#"---
name: unclosed
---

```yaml scenario
steps:
  - id: s1
    name: never closed
    request:
      method: GET
      url: /test
    expect:
      status: 200
"#;
        let err = parse_markdown_scenario(input).unwrap_err().to_string();
        assert!(
            err.contains("Unterminated"),
            "Should report unterminated block: {err}"
        );
    }

    #[test]
    fn test_unclosed_block_after_valid_block() {
        // Even if earlier blocks were closed, a trailing
        // unterminated block must cause an error.
        let input = r#"---
name: partial
---

```yaml scenario
steps:
  - id: s1
    name: ok
    request:
      method: GET
      url: /test
    expect:
      status: 200
```

```yaml scenario
steps:
  - id: s2
    name: never closed
    request:
      method: GET
      url: /test
    expect:
      status: 200
"#;
        let err = parse_markdown_scenario(input).unwrap_err().to_string();
        assert!(
            err.contains("Unterminated"),
            "Should report unterminated block: {err}"
        );
    }

    #[test]
    fn test_only_non_scenario_blocks_fails() {
        // File has code blocks, but none with `yaml scenario` tag.
        let input = r#"---
name: no scenario blocks
---

```yaml
key: value
```

```json
{"not": "scenario"}
```
"#;
        let err = parse_markdown_scenario(input);
        assert!(
            err.is_err(),
            "Should fail when no ```yaml scenario blocks exist"
        );
    }

    #[test]
    fn test_front_matter_not_at_start() {
        // Front matter must be on the very first line.
        let input = "\n---\nname: test\n---\n";
        let err = parse_markdown_scenario(input);
        assert!(
            err.is_err(),
            "Should reject front matter not starting at line 1"
        );
    }
}
