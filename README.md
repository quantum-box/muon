# muon

Declarative YAML-based API scenario testing framework written in Rust.

## Features

- **YAML-based declarative test definitions** - Write API tests as simple YAML files
- **Variable expansion** - `{{ variable }}` syntax with step-level save/reuse
- **JSON path validation** - Validate nested JSON response fields
- **Array/object length validation** - Assert collection sizes with `json_lengths`
- **SSE stream validation** - Test Server-Sent Events endpoints
- **Markdown scenario files** - Write scenarios in `.scenario.md` with YAML frontmatter
- **Multi-format reporting** - JSON, YAML, and text output formats
- **CI integration** - GitHub Action for easy CI/CD pipeline integration
- **Result reporting** - Optional integration with Tachyon Ops API

## Installation

### Download binary

```bash
# Latest release
gh release download --repo quantum-box/muon \
  -p 'muon-x86_64-unknown-linux-gnu' \
  -D ~/.local/bin --clobber
chmod +x ~/.local/bin/muon-*
mv ~/.local/bin/muon-* ~/.local/bin/muon
```

### Available platforms

| Platform | Binary |
|----------|--------|
| Linux x86_64 | `muon-x86_64-unknown-linux-gnu` |
| Linux ARM64 | `muon-aarch64-unknown-linux-gnu` |
| macOS ARM64 | `muon-aarch64-apple-darwin` |

## Quick start

### 1. Write a scenario

Create `tests/scenarios/hello.yaml`:

```yaml
name: Hello API
description: Basic API health check

config:
  base_url: http://localhost:3000
  headers:
    Content-Type: application/json

steps:
  - name: Health check
    request:
      method: GET
      url: "{{ base_url }}/health"
    expect:
      status: 200
      json:
        status: "ok"
```

### 2. Run tests

```bash
muon -p tests/scenarios -v
```

### 3. With result reporting

```bash
muon -p tests/scenarios \
  --api-url https://api.tachyon.example.com \
  --api-key $TACHYON_OPS_API_KEY
```

## Scenario file format

```yaml
name: User API CRUD
description: Test user lifecycle

config:
  base_url: http://localhost:3000
  headers:
    Authorization: Bearer test-token
    Content-Type: application/json
  timeout: 30

vars:
  initial_value: "hello"

steps:
  - name: Create user
    request:
      method: POST
      url: "{{ base_url }}/api/users"
      body:
        name: "Test User"
        email: "test@example.com"
    expect:
      status: 201
      json:
        name: "Test User"
      json_lengths:
        roles: 2
    save:
      user_id: id

  - name: Get user
    request:
      method: GET
      url: "{{ base_url }}/api/users/{{ user_id }}"
    expect:
      status: 200
      json:
        id: "{{ user_id }}"
        name: "Test User"

  - name: Delete user
    request:
      method: DELETE
      url: "{{ base_url }}/api/users/{{ user_id }}"
    expect:
      status: 204
```

## GitHub Action

Use muon in your CI pipelines:

```yaml
- uses: quantum-box/muon@v0.1.0
  with:
    test-path: tests/scenarios
    base-url: http://localhost:3000
    verbose: 'true'
```

### Action inputs

| Input | Description | Default |
|-------|-------------|---------|
| `test-path` | Path to test file or directory | `tests/scenarios` |
| `filter` | Filter tests by name | |
| `base-url` | Base URL for API under test | |
| `api-url` | Tachyon Ops API URL for reporting | |
| `api-key` | Tachyon Ops API key | |
| `timeout` | Timeout per step (seconds) | `30` |
| `verbose` | Enable verbose logging | `false` |
| `muon-version` | Version tag (e.g., `muon-v0.1.0`) | `latest` |
| `report-format` | Report format (json, yaml, text) | `json` |

## Using as a Rust library

```rust
use muon::{DefaultTestRunner, TestConfigManager, TestRunner};

#[tokio::test]
async fn run_api_scenarios() -> anyhow::Result<()> {
    let mut config = TestConfigManager::new();
    config.add_path("tests/scenarios");

    let scenarios = config.load_all_scenarios()?;
    let runner = DefaultTestRunner::new();

    for scenario in scenarios {
        let result = runner.run(&scenario).await?;
        assert!(result.success, "Test failed: {}", scenario.name);
    }

    Ok(())
}
```

## License

MIT
