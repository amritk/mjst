---
'@amritk/lint': patch
---

Share one ruleset-file loader between the package root and the OpenAPI preset, and isolate three more failure paths.

`@amritk/lint/rules/openapi` carried its own copy of the `extends`/custom-function
loader, and the copies had drifted:

- `createOpenApiRuleset` crashed with a stack overflow on a two-file `extends`
  cycle (`a.yaml` → `b.yaml` → `a.yaml`). Each file read returns a fresh object,
  so an object-identity cycle guard never fires; the shared loader keys on the
  resolved `(basePath, reference)` edge.
- `createOpenApiRuleset(definition, basePath, { restrictTo })` and
  `resolveOpenApiRuleset(name, basePath, { restrictTo })` now accept the same
  trust boundary the package root has had.

Also:

- A `$ref` that is not a URL relative to a remote document (`$ref: "//"`) threw a
  `TypeError` out of the whole lint run; it now stops the origin walk, like any
  other `$ref` that cannot be followed.
- A fixer that throws no longer abandons every other fix queued behind it.
- `loadOasSchema` reports an unknown OpenAPI version by name instead of failing
  inside `JSON.parse`.
