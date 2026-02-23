---
name: Status mismatch (Markdown)
description: Expect failure when HTTP status differs — Markdown format
config:
  base_url: __BASE_URL__
---

# Status Mismatch

The `/created` endpoint returns 201, but we intentionally expect 200
to verify that the runner correctly reports a status mismatch failure.

## Verify mismatch detection

```yaml scenario
steps:
  - name: HTTPステータスのミスマッチを検証
    request:
      method: GET
      url: /created
    expect:
      status: 200
```
