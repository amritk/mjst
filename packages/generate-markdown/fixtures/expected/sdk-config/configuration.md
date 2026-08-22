# Configuration

SDK generation is driven by a single config object that describes the SDK name, version, target outputs, environments, resource tree, client settings, and publishing behavior.

Use the config to keep SDK behavior predictable across generated targets. The top-level `targets` map controls which artifacts are generated, while `resources` controls the public client shape.

A minimal config:

```json
{
  "name": "Acme API",
  "environments": {
    "production": "https://api.acme.com"
  },
  "environmentOrder": [
    "production"
  ],
  "targets": {
    "typescript": {
      "packageName": "@acme/api"
    }
  },
  "resources": {}
}
```

## Identity

What the generated SDK calls itself, everywhere it has to name something.

### name

**Type:** `string`

**Required**

Human-readable SDK or product name used for generated package metadata and client naming.

```json
{
  "name": "Acme API"
}
```

### version

**Type:** `string`

**Required**

Base SDK version. A target-level version overrides this for a specific artifact.

**Constraints:** `pattern: ^\d+\.\d+\.\d+$`

```json
{
  "version": "1.4.0"
}
```

### legacyName

> **Deprecated**

**Type:** `string`

Former spelling of `name`.

> Remove it — `name` has replaced it and the two cannot both be set.

## Output

Which artifacts are generated, and what shape the public client takes.

### targets

**Type:** `object`

**Required**

Per-language packaging, publishing, and emitter options keyed by target id. Add a key for every artifact you want generated.

```json
{
  "targets": {
    "typescript": {
      "packageName": "@acme/api",
      "packageManager": "pnpm"
    },
    "python": {
      "packageName": "acme_api",
      "projectName": "acme-api"
    }
  }
}
```

Set `skip: true` on a target to keep its config in place without generating it.

| Property | Type | Description |
| --- | --- | --- |
| [`typescript`](configuration/typescript.md) | `object` | TypeScript SDK target config. |
| [`python`](configuration/python.md) | `object` | Python SDK target config. |
| `go` | `object` | Go SDK target config. |

#### go

**Type:** `object`

Go SDK target config.

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `packageName` | `string` |  | Import and package name for the generated package. |
| `skip` | `boolean` | `false` | Keep the config in place without generating this target. |

### resources

**Type:** `object`

Resource tree that defines the generated client and resource shape.

```json
{
  "resources": {
    "users": {
      "methods": {
        "list": "get /users",
        "create": "post /users"
      },
      "models": {
        "User": "User"
      }
    }
  }
}
```

## Runtime Behavior

How the generated client behaves once somebody installs it.

### clientSettings

**Type:** `object`

SDK-wide client constructor settings for auth, retries, timeouts, and headers.

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `defaultClientName` | `string` |  | Class name of the generated client. |
| `defaultTimeout` | `number` | `30000` | Request timeout in milliseconds. |
| `defaultHeaders` | `object` |  | Headers every generated request sends. |
| `defaultRetries` | `object` |  | Retry policy the generated runtime applies to failed requests. |

#### defaultRetries

**Type:** `object`

Retry policy the generated runtime applies to failed requests.

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `maxRetries` | `integer` | `2` | Attempts after the first failure. |
| `initialDelaySeconds` | `number` | `1` | Delay before the first retry. |
| `maxDelaySeconds` | `number` | `10` | Ceiling for the backoff delay. |

### environmentOrder

**Type:** `string[]`

**Required**

Insertion order of environments. The first entry is the SDK default.

**Constraints:** `minItems: 1`

### environments

**Type:** `object`

**Required**

Named base URLs the generated client can switch between.

```json
{
  "environments": {
    "production": "https://api.acme.com",
    "sandbox": "https://sandbox.acme.com"
  },
  "environmentOrder": [
    "production",
    "sandbox"
  ]
}
```

### ignoredEndpoints

**Type:** `string[]`

`"<verb> <path>"` endpoints to drop from generation entirely.

```json
{
  "ignoredEndpoints": [
    "get /me",
    "post /internal/reindex"
  ]
}
```

### pagination

**Type:** `object[]`

Named pagination schemes referenced by method-level pagination settings.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | ✅ | Name methods reference this scheme by. |
| `type` | `"cursor" \| "cursorId" \| "cursorUrl" \| "offset" \| "pageNumber"` | ✅ | Which pagination strategy the generated helper implements. |
