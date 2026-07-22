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
   `169.254.169.254` are refused unless `allowPrivateHosts: true` or an explicit
   `allowedHosts` entry.
4. **JSON-only by default** (`JSON.parse`). For YAML pass a custom
   `parse: (content, location) => …` (e.g. wrapping `@amritk/yaml`).
5. **`origins` exists only with `trackOrigins: true`.** Cycles are preserved (the
   cycle point stays a `$ref`), so output is not always fully flat. The remote
   cache is process-wide — `clearRemoteCache()` or `cache: false` when a schema
   may have changed.

Exports: `resolveRefs`, `resolveRefsFromFile`, `clearRemoteCache`,
`getByPointer`, `pointerToPath`, `isPrivateHost` + types. Only the `.` entry.
Install: `bun add @amritk/resolve-refs`.
