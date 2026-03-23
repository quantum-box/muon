---
name: SSE validation failure detection
description: |
  Verify that wrong event_count triggers a validation failure.
config:
  base_url: __BASE_URL__
  timeout: 10
---

# SSE Validation — Failure Detection

## Wrong event count should fail

```yaml scenario
steps:
  - id: wrong_count
    name: Assert wrong event_count is detected
    request:
      method: GET
      url: /sse/completion
    expect:
      status: 200
      sse:
        event_count: 10
```
