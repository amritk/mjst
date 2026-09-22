# Deploy configuration

The same renderer with a different root `x-doc.table`: the required options in a table of their own, and no **Type** column anywhere.

A reference whose readers are writing YAML rather than TypeScript often has nothing to say with a type column — and a reader skimming for what they *must* fill in should not have to read every row to find it.

A minimal config:

```json
{
  "service": "acme-web",
  "region": "us-east-1",
  "build": {
    "command": "bun run build"
  }
}
```

## build

**Type:** `object`

How the service is built before it is deployed.

**Required**

| Property | Default | Description |
| --- | --- | --- |
| [`command`](#command) |  | Command that produces the build output. |

**Optional**

| Property | Default | Description |
| --- | --- | --- |
| `outDir` | `"dist"` | Directory the build writes to. |
| `cache` | `true` | Reuse the dependency cache between builds. |

### command

**Examples:** `"bun run build"`

## env

**Type:** `Record<string, string>`

Environment variables every instance is started with.

## Service

What is deployed, and where it lands.

**Required**

| Property | Default | Description |
| --- | --- | --- |
| [`service`](#service-1) |  | Name the deployment is published under. It has to be unique within the account. |
| `region` |  | Region the service runs in. |

**Optional**

| Property | Default | Description |
| --- | --- | --- |
| [`domain`](#domain) |  | Custom domain to route to the service. |
| [`replicas`](#replicas) | `1` | How many instances to run. |

### service

**Examples:** `"acme-web"`

### domain

The certificate is issued on the first deploy, so the first one after adding a domain takes a few minutes longer.

**Examples:** `"acme.com"`

### replicas

**Constraints:** `minimum: 1`
