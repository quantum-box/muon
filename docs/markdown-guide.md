# Markdown Scenario Guide

This guide covers the `.scenario.md` file format — how to write, structure,
and convert existing YAML scenarios into the Markdown format.

## Why Markdown?

The Markdown format adds **human-readable documentation** alongside test
definitions. Benefits include:

- Each step can have an explanation of *why* it exists and what it verifies
- Scenarios double as living API documentation
- Code reviewers can understand test intent without reading raw YAML
- Front matter keeps metadata cleanly separated from test steps

## File Structure

A `.scenario.md` file has three sections:

```
┌──────────────────────────────────────┐
│  ---                                 │  ← YAML front matter
│  name: ...                           │    (metadata, config, vars)
│  config:                             │
│    ...                               │
│  ---                                 │
├──────────────────────────────────────┤
│  # Title                             │  ← Markdown body
│                                      │    (headings, prose, links)
│  Description text ...                │
├──────────────────────────────────────┤
│  ## Section heading                  │
│                                      │
│  Explanation of what this step does  │
│                                      │
│  ```yaml scenario                    │  ← Test step block
│  steps:                              │    (same YAML syntax as .yaml)
│    - id: step_name                   │
│      ...                             │
│  ```                                 │
└──────────────────────────────────────┘
```

### Front matter

The front matter block (delimited by `---`) is parsed as YAML and supports
all the same top-level fields as a `.yaml` scenario file:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Scenario display name |
| `description` | No | Short description of the scenario |
| `tags` | No | List of tags for filtering |
| `config` | No | Configuration (base_url, headers, timeout, etc.) |
| `vars` | No | Initial variables available to all steps |

Example:

```yaml
---
name: User CRUD operations
description: Full lifecycle test for user management API
tags:
  - users
  - crud
config:
  headers:
    Authorization: Bearer dummy-token
    Content-Type: application/json
  timeout: 30
  continue_on_failure: false
vars:
  test_email: test@example.com
---
```

### Markdown body

Between the front matter and the first `yaml scenario` block, write
free-form Markdown. Use a `#` heading matching the scenario name, followed
by a paragraph describing the overall purpose.

### Test step blocks

Wrap test steps in fenced code blocks with the **`yaml scenario`** info
string (the space between `yaml` and `scenario` is required):

````markdown
```yaml scenario
steps:
  - id: create_user
    name: Create user
    request:
      method: POST
      url: /api/users
      body:
        name: "Test User"
    expect:
      status: 201
    save:
      user_id: id
```
````

**Rules:**

- Each block must contain a `steps:` key with a list of step objects
- Multiple blocks are concatenated in document order
- Steps in later blocks can reference outputs from earlier blocks
- The `id` field is recommended when a step's output is used elsewhere

## Variable References

### Within the same block

Use `save` to capture response values, then reference them with `{{ var }}`:

```yaml
steps:
  - name: Create and reference
    request:
      method: POST
      url: /api/items
    expect:
      status: 201
    save:
      item_id: id
  - name: Use saved value
    request:
      method: GET
      url: /api/items/{{ item_id }}
    expect:
      status: 200
```

### Across blocks

Use `{{steps.<step_id>.outputs.<json_path>}}` to reference values from
steps in other blocks:

````markdown
```yaml scenario
steps:
  - id: create_item
    name: Create item
    request:
      method: POST
      url: /api/items
    expect:
      status: 201
```

```yaml scenario
steps:
  - name: Fetch created item
    request:
      method: GET
      url: /api/items/{{steps.create_item.outputs.id}}
    expect:
      status: 200
```
````

## Converting from YAML

### Step-by-step process

Given a YAML scenario file:

```yaml
name: API Test
description: Test description
config:
  headers:
    Authorization: Bearer dummy-token
steps:
  - id: step1
    name: Create resource
    request:
      method: POST
      url: /v1/resources
      body:
        name: test
    expect:
      status: 201
    save:
      resource_id: id
  - id: step2
    name: Get resource
    request:
      method: GET
      url: /v1/resources/{{ resource_id }}
    expect:
      status: 200
```

Convert to Markdown:

1. **Extract front matter** — move `name`, `description`, `config`, `tags`,
   and `vars` into the `---` delimited block

2. **Add title and description** — create a `#` heading and introductory
   paragraph

3. **Split steps into logical groups** — each group becomes a `yaml scenario`
   block with a `##` heading

4. **Add explanatory text** — before each block, describe what the step does
   and why

5. **Assign `id` fields** — ensure steps referenced by later blocks have an
   `id`

Result:

````markdown
---
name: API Test
description: Test description
config:
  headers:
    Authorization: Bearer dummy-token
---

# API Test

Test description

## Create resource

Create a new resource to verify the POST endpoint.

```yaml scenario
steps:
  - id: step1
    name: Create resource
    request:
      method: POST
      url: /v1/resources
      body:
        name: test
    expect:
      status: 201
    save:
      resource_id: id
```

## Get resource

Retrieve the resource created in the previous step.

```yaml scenario
steps:
  - id: step2
    name: Get resource
    request:
      method: GET
      url: /v1/resources/{{steps.step1.outputs.resource_id}}
    expect:
      status: 200
```
````

### Conversion checklist

- [ ] Front matter contains `name` (required) and `config`
- [ ] `steps` are NOT in the front matter (they go in code blocks)
- [ ] Each `yaml scenario` block has a `steps:` key
- [ ] Cross-block references use `{{steps.<id>.outputs.<path>}}`
- [ ] Each section has a `##` heading with brief explanation
- [ ] File extension is `.scenario.md` (not `.md`)

## Best Practices

### Writing good explanations

- **Be concise** — 1-2 sentences per step section
- **Explain intent** — why this step exists, not what it does mechanically
- **Link to API docs** — reference relevant documentation when helpful

Good:
```markdown
## Verify idempotency

Sending the same creation request twice should return the existing resource
instead of creating a duplicate (409 Conflict).
```

Bad:
```markdown
## Step 2

POST to the endpoint.
```

### Grouping steps

- **One step per block** for important steps that need explanation
- **Multiple steps per block** for related operations (e.g., create + verify)
- **Use descriptive headings** that summarize the verification goal

### Tags for filtering

Use `tags` in front matter to enable selective test execution:

```yaml
---
name: Payment flow
tags:
  - payment
  - slow
  - requires-stripe
---
```

Run only specific tags:
```bash
muon -p tests/scenarios --filter payment
```

### Config best practices

- Set `continue_on_failure: false` (default) for sequential scenarios
- Use `timeout: 30` for normal API calls, increase for slow operations
- Define shared headers in `config.headers` to avoid repetition
