# @amritk/resolve-refs

Resolve and inline JSON Schema / OpenAPI `$ref`s — internal pointers, cross-file
refs, and remote (http/https) documents — into a single dereferenced document.

- **One-pass, cached.** Every unique ref is resolved once; cycles are broken with
  an empty object so the result is always finite.
- **Cross-file + remote.** Relative refs resolve against the document they appear
  in (a ref inside a remote doc stays remote, one inside a local file stays
  local). Fetched remote documents are cached for the lifetime of the process.
- **Default-deny SSRF guard.** Remote refs to loopback, private, link-local, and
  cloud-metadata (`169.254.169.254`) hosts are refused unless you opt in.

## Usage

```ts
import { resolveRefs, resolveRefsFromFile } from '@amritk/resolve-refs'

// In-memory, internal (#/...) refs only:
const { resolved } = resolveRefs(myDocument)

// From disk or a URL, including cross-file and remote refs:
const result = await resolveRefsFromFile('./schema.json')
const remote = await resolveRefsFromFile('https://api.example.com/schema.json', {
  allowedHosts: ['api.example.com'],
})
```

### Options (`resolveRefsFromFile`)

| Option | Default | Description |
|:---|:---|:---|
| `remote` | `true` | Whether http(s) refs may be fetched at all. |
| `allowedHosts` | `[]` | If non-empty, only these hosts may be fetched. An explicit entry bypasses the private-host guard. |
| `allowPrivateHosts` | `false` | Allow loopback/private/link-local targets. Left off, these are refused as an SSRF guard. |

Errors (a missing file, a refused host, a bad URL) are collected on
`result.errors` rather than thrown; the corresponding ref resolves to `{}` so the
rest of the document still resolves.

`clearRemoteCache()` drops every cached remote document — useful in tests or
long-lived sessions where remote schemas may change.

## Documents

Every document — local file or remote — is parsed as **JSON**. mjst works with
JSON Schema documents only, so this resolver stays JSON-only and dependency-free.
(The Loupe linter's sibling resolver additionally accepts YAML.)
