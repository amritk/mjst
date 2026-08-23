# TypeScript

Add `typescript` under `targets` to generate a TypeScript SDK package.

TypeScript SDK target config.

```json
{
  "targets": {
    "typescript": {
      "packageName": "@acme/api",
      "packageManager": "pnpm",
      "destinations": {
        "production": {
          "repo": "acme/acme-typescript"
        }
      }
    }
  }
}
```

| Property | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `packageName` | `string` | ✅ |  | Import and package name for the generated TypeScript package. |
| `packageManager` | `"npm" \| "pnpm" \| "yarn" \| "bun"` |  | `"npm"` | Package manager preference for generated package metadata. |
| `skip` | `boolean` |  | `false` | Keep the config in place without generating this target. |
| `options` | `object` |  |  | TypeScript emitter options. |
| `destinations` | `object` |  |  | GitHub destinations for generated output. |

## packageName

**Examples:** `"@acme/api"`

## destinations

| Property | Type | Description |
| --- | --- | --- |
| `production` | `object` | Push generated output to a GitHub repository. |

## Emitter Options

How the TypeScript emitter names things.

TypeScript emitter options.

`propertyCasing: 'sdk'` also generates a wire↔SDK remap, so request and response bodies stay correct on the network.

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `propertyCasing` | `"wire" \| "sdk"` | `"wire"` | How generated properties and parameters are named. `wire` preserves the OpenAPI names, so `order_by` stays `order_by`; `sdk` emits the idiomatic `orderBy`. |

## Destinations

Use `destinations.production` to push generated output to a GitHub repository.

Push generated output to a GitHub repository.

| Property | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `repo` | `string` | ✅ |  | GitHub repository in `owner/name` form. |
| `branch` | `string` |  | `"main"` | Default branch releases are promoted to. Generated output itself always goes to the fixed `scalar-generated` branch. |

### repo

**Examples:** `"acme/acme-typescript"`
