# @amritk/resolve-refs

## 0.2.0

### Minor Changes

- 51c2032: Close package gaps and add performance improvements.

  - **resolve-refs:** the SSRF guard now follows redirects manually and re-checks
    every hop (an allow-listed host can no longer bounce to a private/metadata
    address), and detects IPv4-mapped IPv6 and decimal/octal/hex IPv4 encodings.
    Concurrent loads of the same remote URL are coalesced onto one request.
  - **runtime-validators:** adds `unevaluatedProperties` / `unevaluatedItems`
    (annotation tracking across `$ref`/`allOf`/`if`-`then`-`else`/`anyOf`/`oneOf`/
    `dependentSchemas`, matching Ajv), and a linear `uniqueItems` fast-path for
    all-primitive arrays.
  - **generate-validators:** validates `const`, `dependentRequired`, and
    `propertyNames` (pattern form); regex `pattern`s are now correctly escaped so
    patterns containing `/` (or backslashes) emit compiling literals.
  - **generate-parsers:** corrects regex `pattern` escaping (backslashes are no
    longer doubled, which previously turned `\d` into a literal backslash) via the
    shared `@amritk/helpers/escape-regex-pattern`.
  - **helpers:** new `escape-regex-pattern` export and `hasDependentRequired` /
    `hasPropertyNames` guards; `resolveDynamicRefs` now rewrites `$dynamicRef`s
    nested inside array keywords (`allOf`, `anyOf`, `oneOf`, `prefixItems`).
  - **cli:** invalid `--input` / `--helpers` values fail fast with a clear message
    instead of being silently dropped, and `tsc` build failures include the
    compiler output.
  - **adapters:** the Zod and Valibot adapters now report when an unrepresentable
    type is widened to "accept anything" instead of dropping it silently.

- 4f03a79: Add an opt-in `trackOrigins` option to `resolveRefs` and `resolveRefsFromFile`.

  When set, the result carries an `origins` map: for every object/array inlined in
  place of a `$ref`, it records the document (`location`) and in-file path
  (`pointer`) it was defined at. Because the resolver shares one object per repeated
  `$ref` target, a consumer can map any node in the resolved tree back to its source
  with a single identity lookup — no need to re-walk the `$ref` chain across the
  unresolved documents. First-write-wins, so a node reached through a chained ref
  keeps its definition origin rather than an intermediate pointer. Also exports the
  `pointerToPath` helper and the `Origin` / `OriginMap` / `ResolveRefsOptions` types.
  The option defaults to `false`, so existing callers are unaffected.

## 0.1.2

### Patch Changes

- abab839: Percent-decode URI-encoded segments in `getByPointer` before applying `~1`/`~0` unescaping, so keys like `{volume_id}` encoded as `%7Bvolume_id%7D` resolve correctly and `%2F` within a segment is never treated as a path separator.

## 0.1.1

### Patch Changes

- 6218978: chore: version bumps

## 0.1.0

### Minor Changes

- 6fdb8bf: Add `@amritk/resolve-refs`: resolve and inline JSON Schema / OpenAPI `$ref`s —
  internal pointers, cross-file refs, and remote (http/https) documents — into a
  single dereferenced document. One-pass with per-session caching of fetched
  remote documents, cycle-safe, and guarded by a default-deny SSRF check
  (loopback / private / link-local / cloud-metadata hosts are refused unless
  explicitly allow-listed).
