---
name: JSON exact match success (Markdown)
description: Verify json expectation matches exact values using Markdown format
config:
  base_url: __BASE_URL__
---

# JSON Exact Match

Verify that the `json` expectation correctly matches exact field values
from the `/sample` endpoint response.

## Verify JSON values

```yaml scenario
steps:
  - name: JSON値が一致することを検証
    request:
      method: GET
      url: /sample
    expect:
      status: 200
      json:
        data.kind: list
        data.items.0.id: item-1
```
