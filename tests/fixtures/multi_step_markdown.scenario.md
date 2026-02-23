---
name: Multi-step Markdown scenario
description: Verify that multiple yaml scenario blocks execute in sequence and share context
config:
  base_url: __BASE_URL__
  timeout: 5
---

# Multi-Step Scenario

This scenario uses multiple `yaml scenario` code blocks to verify that
steps defined across separate blocks execute in order and share saved variables.

## Step 1: Fetch sample data

Retrieve the sample endpoint and save `data.kind` for later use.

```yaml scenario
steps:
  - id: fetch_sample
    name: サンプルデータを取得する
    request:
      method: GET
      url: /sample
    expect:
      status: 200
      json:
        data.kind: list
      json_lengths:
        data.items: 2
    save:
      kind_value: data.kind
```

## Step 2: Verify headers

Independently verify that the `/headers` endpoint returns expected headers.

```yaml scenario
steps:
  - id: check_headers
    name: ヘッダーが正しいことを検証
    request:
      method: GET
      url: /headers
    expect:
      status: 200
      headers:
        x-test-header: ok
```

## Step 3: Contains check

Verify the text endpoint contains expected substring.

```yaml scenario
steps:
  - id: text_check
    name: テキストの部分一致を検証
    request:
      method: GET
      url: /text
    expect:
      status: 200
      contains:
        - runner world
```
