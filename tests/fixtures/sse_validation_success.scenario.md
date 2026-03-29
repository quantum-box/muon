---
name: SSE validation with enhanced assertions
description: |
  Verify event_count, event_count_by_type, exact_event_sequence,
  and ends_with SSE validation features using exact match checks.
config:
  base_url: __BASE_URL__
  timeout: 10
---

# SSE Validation — Enhanced Assertions

## Test 1: Completion stream (3 events)

Validate a simple completion SSE stream with all new assertion types.

```yaml scenario
steps:
  - id: completion
    name: Validate completion SSE stream
    request:
      method: GET
      url: /sse/completion
    expect:
      status: 200
      sse:
        event_count: 3
        event_count_by_type:
          attempt_completion: 1
          usage: 1
          done: 1
        exact_event_sequence:
          - attempt_completion
          - usage
          - done
        ends_with: done
        has_no_events:
          - error
          - tool_call
        events:
          - event: attempt_completion
            data_eq:
              result: "Task done."
              command: null
              is_finished: true
          - event: usage
            data_exists:
              - prompt_tokens
              - completion_tokens
              - total_tokens
          - event: done
```

## Test 2: Streaming with repeated events (5 events)

Validate a streaming SSE response with multiple `say` chunks.
Both `event_sequence` (deduped) and `exact_event_sequence` (no dedup)
are tested together.

```yaml scenario
steps:
  - id: streaming
    name: Validate streaming SSE with repeated say events
    request:
      method: GET
      url: /sse/streaming
    expect:
      status: 200
      sse:
        event_count: 5
        event_count_by_type:
          say: 3
          usage: 1
          done: 1
        event_sequence:
          - say
          - usage
          - done
        exact_event_sequence:
          - say
          - say
          - say
          - usage
          - done
        ends_with: done
```
