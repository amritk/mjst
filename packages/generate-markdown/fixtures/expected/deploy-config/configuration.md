# Deploy configuration

The same renderer under a different root `x-mjst.markdown.table`: the options you have to fill in at the top of every table, and no **Type** column anywhere.

A reference whose readers are writing YAML rather than TypeScript often has nothing to say with a type column — and a reader skimming for what is required should not have to read every row to find it.

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

| Property | Default | Description |
| --- | --- | --- |
| [`command`](#command) _required_ |  | Command that produces the build output. |
| `outDir` | `"dist"` | Directory the build writes to. |
| `cache` | `true` | Reuse the dependency cache between builds. |

### command

**Examples:** `"bun run build"`

## env

**Type:** `Record<string, string>`

Environment variables every instance is started with.

## Service

What is deployed, and where it lands.

| Property | Default | Description |
| --- | --- | --- |
| [`service`](#service-1) _required_ |  | Name the deployment is published under. It has to be unique within the account. |
| [`region`](#region) _required_ |  | Region the service runs in. |
| [`domain`](#domain) |  | Custom domain to route to the service. |
| [`replicas`](#replicas) | `1` | How many instances to run. |

### service

**Examples:** `"acme-web"`

### region

**Allowed values:** `"us-east-1"`, `"eu-west-1"`, `"ap-south-1"`

### domain

The certificate is issued on the first deploy, so the first one after adding a domain takes a few minutes longer.

**Examples:** `"acme.com"`

### replicas

**Constraints:** `minimum: 1`
