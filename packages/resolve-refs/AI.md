# @amritk/resolve-refs — notes for AI coding agents

Resolve and inline JSON Schema / OpenAPI `$ref`s (internal, cross-file, remote)
into a single dereferenced document, with session caching and a default-deny
SSRF guard. Full reference is [README.md](./README.md).

> Pre-alpha: APIs change in **minor** versions.

## Minimal example

```ts
import { resolveRefs, resolveRefsFromFile } from '@amritk/resolve-refs'

// In-memory, INTERNAL refs only:
const { resolved, errors } = resolveRefs(myDocument)

// From disk (cross-file + remote):
const result = await resolveRefsFromFile('./schema.json')

// Remote requires host allow-listing:
const remote = await resolveRefsFromFile('https://api.example.com/schema.json', {
  allowedHosts: ['api.example.com'],
})
```

## Gotchas — where agents fail

1. **`resolveRefs` is in-memory only.** It does NOT load other files/URLs —
   external refs stay in place and are pushed to `errors` (the ref becomes `{}`).
   Use `resolveRefsFromFile` for cross-file/remote.
2. **Errors are collected, never thrown.** A missing file, refused host, or bad
   URL lands on `result.errors` while the rest still resolves. Always check it.
3. **Default-deny SSRF guard.** Remote refs to loopback / private / link-local /
   `169.254.169.254` / metadata hosts by name (`metadata.google.internal`,
   `*.internal`) are refused unless `allowPrivateHosts: true` or an explicit
   `allowedHosts` entry. Hostnames are also resolved and refused when they point
   at a private address (`verifyDns: false` opts out).
4. **Local `$ref`s are confined to the root document's directory.** A
   `{"$ref": "../common/schemas.json"}` is refused by default — pass
   `allowedRoots: ['./specs']` (or whatever contains both files) to allow it.
   `localRefs: false` refuses cross-file reads entirely.
5. **JSON-only by default** (`JSON.parse`). For YAML pass a custom
   `parse: (content, location) => …` (e.g. wrapping `@amritk/yaml`).
6. **`origins` exists only with `trackOrigins: true`.** Cycles are preserved (the
   cycle point stays a `$ref`), so output is not always fully flat. The remote
   cache is process-wide but credential-scoped and bounded (10 min TTL, 256
   entries) — `clearRemoteCache()` / `clearRemoteCache(url)` or `cache: false`
   when a schema may have changed.
7. **A resolve is bounded** by `maxDocuments` (500), `totalTimeoutMs` (60s), and
   `maxDepth` (512). Hitting one is an entry on `errors`, never a throw.

Exports: `resolveRefs`, `resolveRefsFromFile`, `clearRemoteCache`,
`getByPointer`, `pointerToPath`, `isPrivateHost`, `assertPublicHost` + types.
Only the `.` entry.
Install: `bun add @amritk/resolve-refs`.
