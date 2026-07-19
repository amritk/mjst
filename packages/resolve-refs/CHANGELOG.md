# @amritk/resolve-refs

## 0.4.3

### Patch Changes

- 6e7c65e: Slim published packages — comments are now stripped from the compiled JS in `dist` (they were duplicating the JSDoc that already ships in the `.d.ts` files, which is what editors read), and `@amritk/lint` now minifies its bundled OpenAPI meta-schema JSON documents. Unpacked size drops ~30% across the board (for example `@amritk/lint` 448 kB → 307 kB, `@amritk/generate-parsers` 293 kB → 191 kB) with no behavior change: declaration files keep their docs, `/* @__PURE__ */` annotations and the CLI shebang survive, and `@amritk/helpers` still ships its TypeScript sources for embedded mode.

## 0.4.2

### Patch Changes

- 4e23c02: Packaging fixes across all published packages: the `types` export condition now precedes runtime conditions (`default`/`import`) so TypeScript resolves the declared `.d.ts` explicitly instead of relying on file adjacency, and published tarballs now include the LICENSE file (copied in during the publish job).

## 0.4.1

### Patch Changes

- 8c69893: Close an SSRF-guard gap for IPv4-in-IPv6 addresses. `isPrivateHost` only decoded the IPv4-**mapped** form (`::ffff:X:Y`), so the WHATWG-URL-normalized hex of an IPv4-**compatible** address slipped through: `http://[::127.0.0.1]/` normalizes to `::7f00:1` and `http://[::169.254.169.254]/` (cloud metadata) to `::a9fe:a9fe`, neither of which the mapped-only check matched — and `denialReason` then allowed the fetch. The guard now fully expands the IPv6 address and rejects every private IPv4 embedding the URL parser can produce (compatible `::X:Y`, mapped `::ffff:X:Y`, translated `::ffff:0:X:Y`, and NAT64 `64:ff9b::/96`), plus the fully-expanded loopback `0:0:0:0:0:0:0:1`. Public embeddings (e.g. `::ffff:1.1.1.1`) remain allowed.

## 0.4.0

### Minor Changes

- 641afa9: Close four resolution gaps:

  - **Cycles keep their recursive branch.** A reference cycle no longer collapses
    to an empty `{}` stub. The cycle point stays a `$ref` that resolves within
    the output document — a cross-file cycle target is hoisted into the root's
    `$defs` — so recursive schemas survive dereferencing intact.
  - **`$id` base-URI scoping.** A ref whose URI (resolved against the enclosing
    base) matches an embedded resource's `$id` now resolves to it without
    fetching, and `$anchor`/`$dynamicAnchor` names bind within the resource that
    declares them before any document-global fallback — so bundled schemas and
    duplicate anchor names resolve correctly. Plain `#/pointer` fragments stay
    document-root-relative, and document retrieval remains location-based; the
    exact subset is documented in the README.
  - **OpenAPI Reference Objects.** A `$ref` whose only siblings are `summary` /
    `description` inlines the target with those annotations overriding, instead
    of an `allOf` wrapper that is invalid in Path Item / Response / Parameter
    positions.
  - **Remote fetch options.** New `ResolveOptions`: `headers` (record or per-URL
    function; never sent across cross-origin redirects), `fetch` (custom
    implementation — the SSRF guard still checks every hop), `timeoutMs`,
    `maxRedirects`, `maxBytes`, and `cache: false` to bypass the session cache
    for one call.

### Patch Changes

- 4715e6f: `resolveRefs` now records an error for each external (non-`#`) `$ref` it
  encounters instead of silently leaving the node unresolved. The in-memory
  resolver can't load other documents, so an external ref (another file or an
  http(s) URL) is kept in place and surfaced on `result.errors` with a message
  pointing callers at `resolveRefsFromFile` — matching how unresolvable internal
  pointers are already reported, so a half-resolved document no longer passes
  without a diagnostic.
- 22c4b8f: Fix two SSRF-guard gaps in remote `$ref` resolution:

  - Trailing-dot hostnames (`localhost.`, `api.localhost.`) — the FQDN-root form
    that resolves to the same address — bypassed the by-name loopback check.
    `isPrivateHost` now strips a trailing dot before matching, so these are
    refused by default like their dotless forms.
  - The process-global remote document cache was consulted before the SSRF/policy
    check, so a URL fetched once under permissive options (`allowPrivateHosts`, a
    broad `allowedHosts`) could be served to a later call whose options
    (`remote: false`, a stricter host set, or the default private-host guard)
    should refuse it. The policy is now re-evaluated on every remote serve,
    including cache hits.

## 0.3.0

### Minor Changes

- 7147396: Resolve `$ref`, `$dynamicRef`/`$dynamicAnchor`, and `$recursiveRef`/`$recursiveAnchor` when linting.

  `@amritk/resolve-refs` now dereferences plain-name anchors (`#node` → `$anchor`/`$dynamicAnchor`) and the dynamic/recursive reference keywords, in both the in-memory and cross-file resolvers. Dynamic/recursive references bind to their document-global anchor (the single-bundle case; nested `$id` base-URI re-scoping is not modelled).

  `mjst lint` now dereferences documents before running rules, so rules with `resolved: true` (the ruleset default) see through references — including cross-file refs, whose findings are attributed to the referenced file's own `line:column`. New flags: `--no-resolve` to disable, and `--resolve-remote` / `--allowed-hosts` / `--allow-private-hosts` to opt into fetching remote (`http(s)`) refs (off by default so a lint run stays offline).

## 0.2.3

### Patch Changes

- c288a90: Security and robustness hardening:

  - **resolve-refs**: the SSRF guard now rejects non-`http(s)` redirect targets, so a
    remote schema can no longer bounce a fetch to `file://`/`data:` and disclose
    local files; remote fetches also gain a timeout and a response-size cap.
  - **generate-parsers / generate-validators / helpers**: schema-controlled strings
    (property names, enum values, patterns, required keys) are now escaped via
    `JSON.stringify` before being emitted into generated TypeScript. Previously a
    crafted enum value or property name could break out of — or inject code into —
    the generated output.
  - **runtime-validators**: recursive `$ref` schemas (e.g. `{ $ref: '#' }`) no longer
    overflow the stack; property presence is checked with `Object.hasOwn`, fixing a
    false-accept of an inherited `constructor` and a false-reject of a real
    `__proto__` property.
  - **yaml**: alias expansion is bounded (billion-laughs protection) and parser
    nesting is depth-limited, so a tiny adversarial document can no longer hang the
    process or overflow the stack.
  - **helpers / yaml / resolve-refs**: `__proto__` keys in untrusted input are stored
    as own data instead of mutating an object's prototype.

## 0.2.2

### Patch Changes

- 1e2b4f5: Preserve keywords sibling to a `$ref` when inlining. Per JSON Schema 2020-12 a
  `$ref` does not suppress its sibling keywords — they apply alongside the
  referenced schema — but the resolver replaced the whole node with the resolved
  target, silently dropping constraints like `maxLength`, `minimum`, `enum`, or an
  extra `required`. Siblings are now combined with the target in an `allOf` (so a
  constraint present on both sides is never lost), while a `$ref` with no siblings
  still inlines directly as before. The sibling-free target is what gets cached, so
  each occurrence keeps its own siblings.

  The same fix applies to the cross-file/remote resolver (`resolveRefsFromFile`),
  which additionally now recurses into a `$ref` node's siblings during prefetch, so
  a cross-file `$ref` that appears beside another `$ref` is loaded and inlined
  instead of being missed.

## 0.2.1

### Patch Changes

- b0c83e7: Fix several correctness issues surfaced by a code review:

  - **yaml**: negative hexadecimal and octal scalars (`-0x10`, `-0o10`) no longer
    have their sign double-applied and flipped positive; out-of-range or malformed
    `\x`/`\u`/`\U` escapes in double-quoted scalars are now treated as literal text
    instead of throwing a `RangeError` (via `String.fromCodePoint`) or silently
    dropping the following characters.
  - **resolve-refs**: `pointerToPath` only coerces canonical RFC 6901 array-index
    tokens to numbers, so a numeric object key with a leading zero such as `"01"`
    is kept as a string rather than aliased to a different key. The shared
    JSON Pointer segment decode is now factored into one helper.
  - **generate-validators**: object/array `const` checks compare with a new
    order-independent `valuesEqual` runtime helper instead of `JSON.stringify`, so
    a reordered-but-equal value matches (in step with the interpreter);
    `propertyNames` now validates every key against the full subschema (length,
    enum, const, `$ref`), not just the `pattern` form; and the draft-04 boolean
    `exclusiveMinimum`/`exclusiveMaximum` form is honored.
  - **helpers**: add `hasStrictExclusiveMinimum` / `hasStrictExclusiveMaximum`
    guards for the draft-04 boolean exclusive-bound form.

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
