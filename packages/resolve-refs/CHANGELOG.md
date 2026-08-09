# @amritk/resolve-refs

## 0.5.3

### Patch Changes

- 0b294a1: Retry the publish that npm has refused since 0.14.0 and 0.5.0.

  Every version of these two since 2026-08-04 has been built, tested and packed by
  the release job and then refused by the registry with an empty 403, while the
  other ten packages publish from the same run. Nothing in either package changed
  here — the bump gives the release a version to attempt while the block is with
  npm support.

## 0.5.2

### Patch Changes

- 2e5dada: Republish after 0.14.4 and 0.5.1 never reached npm.

  Both versions were built, tested and packed by the release job, and both were
  refused by the registry with a bare 403 while the other ten packages published
  from the same job. Nothing in either package changed — this bump exists to give
  the release something to publish, so npm has the versions its consumers expect.

## 0.5.1

### Patch Changes

- 4178e8d: Patch release across all packages.

## 0.5.0

### Minor Changes

- d749ee2: Keep a `$dynamicRef` the dynamic scope has to answer, instead of inlining one
  wrong target

  A `$dynamicRef` binds at _evaluation_ time to the outermost `$dynamicAnchor` of
  its name along the chain of resources actually being applied, so the same keyword
  can resolve to different schemas depending on where evaluation entered from.
  Inlining happens once, which means a resolver that inlines every `$dynamicRef` is
  guessing — and a wrong guess changes what the document accepts, in both
  directions.

  So it no longer guesses. Where the binding is decidable it inlines as before:

  - a **pointer fragment** (`#`, `#/$defs/items`) is a plain `$ref` per the spec —
    there is no anchor to late-bind to;
  - an **anchor name declared at most once** in the document has only one schema the
    dynamic lookup could ever reach.

  Where it is not decidable — an anchor name declared twice or more — the
  `$dynamicRef` stays in the output, along with the scaffolding it needs to resolve
  at validation time: the `$dynamicAnchor`s it may bind to and the `$id`s that
  delimit the resources those anchors live in. Inlining anything whose copy would
  drop a resource out of that chain is held back for the same reason. This is the
  move the resolver already makes for a reference cycle — keep the reference rather
  than collapse it to one wrong answer — now covering both cases under one rule.

  Consumers see no new API and no new errors: a kept reference is not a failure, it
  is a reference the resolver could not answer without changing the document's
  meaning, resolvable against the output exactly as it was against the input.
  `trackOrigins` records nothing for one, because nothing was copied in its place.

  On the `$ref` corpus of the official JSON Schema Test Suite the package is now at
  **170 / 170**.

  Two limits stay, documented in the code: a multi-document `resolveRefsFromFile`
  still inlines (preservation only helps when the scaffolding survives into the
  output, which a single-document resolve guarantees and a flattened multi-document
  one does not), and 2019-09's `$recursiveRef` has the same defect but no corpus to
  move it against.

- 945e8f2: Close the local-file, cache-scoping, and fan-out gaps in the resolver's guards

  This package's selling point is a default-deny SSRF guard. These are the places
  the guard did not reach.

  **Local `$ref`s are now confined to the root document's directory.** `$ref`
  resolution against the filesystem had no containment check and no way to turn it
  off: `{"$ref": "../../../etc/passwd"}` (or an absolute path) read whatever the
  process could read, and any caller supplying the YAML `parse` callback the docs
  recommend got arbitrary text, not just JSON. A local ref must now resolve under
  `dirname(rootLocation)`; both the lexical and the symlink-resolved path have to
  land inside it, so a symlink planted in the tree cannot be used to escape.

  This is a **behavior change**: a legitimate cross-directory ref
  (`../common/schemas.json` — a very normal split-spec layout) now fails until you
  widen it with the new `allowedRoots`, which the refusal message names. The
  default was chosen to match the stance the remote path already took — deny, then
  opt in — since the escaping ref and the traversal attack are the same shape and
  only the caller can tell them apart. The root document you name is exempt; it is
  what you asked for. `localRefs: false` refuses cross-file reads entirely.

  **The session cache no longer leaks documents across credentials.** It was keyed
  by URL alone, so a call carrying one tenant's `Authorization` header handed that
  tenant's private document straight to a later call carrying no credentials at
  all — and in-flight coalescing additionally made the second caller inherit the
  first one's `fetch`, `timeoutMs`, and `maxBytes`. Both keys now include a digest
  of the effective headers plus the `fetch`/`parse` identities and the transfer
  limits. The cache is also bounded now (10-minute TTL, 256 entries, LRU
  eviction) instead of growing for the life of the process, and
  `clearRemoteCache(url)` can drop a single document.

  **A resolve is bounded as a whole.** A root document with 500 `$ref`s to distinct
  URLs drove 501 fetches with nothing but the per-hop timeout bounding it — an
  egress amplifier and a host scanner, from the resolver's network position. New
  `maxDocuments` (500) and `totalTimeoutMs` (60s, applied across the whole resolve
  and not just per hop) cap it.

  **Deeply nested documents no longer throw.** `'{"a":'.repeat(20000)` raised
  `RangeError: Maximum call stack size exceeded` out of the walkers, breaking the
  package's stated contract that errors are collected and never thrown. Every
  recursive walk is depth-capped (`maxDepth`, default 512); past the limit the
  subtree is left unresolved and one `ResolveError` is recorded.

  **The SSRF guard is no longer name-blind.** `metadata.google.internal`,
  `metadata.goog`, `metadata`, `instance-data`, and anything under the reserved
  `.internal` TLD are refused by name — the IP check missed all of them, because
  callers reach the metadata service by name. The new `assertPublicHost` also
  resolves each remote hostname and refuses it when _any_ address it points at is
  non-public, which closes the `127.0.0.1.nip.io` class of bypass; it fails closed,
  and `verifyDns: false` (or an `allowedHosts` entry) opts out where names resolve
  at an egress proxy. DNS rebinding is narrowed, not closed: pinning the connection
  to the verified address is not something Node's `fetch` exposes, and the README
  says so rather than overclaiming.

  **Missing IP ranges added:** `fec0::/10` (deprecated site-local),
  `198.18.0.0/15` (benchmarking), and `192.0.0.0/24` (IETF protocol assignments).

  **`allowedHosts` is no longer a footgun.** Matching was case-sensitive and
  port-exact, so `['example.com']` refused `https://example.com:8443/a.json` and
  `['EXAMPLE.com']` refused everything — failing closed, but pushing users toward
  `allowPrivateHosts`, which is a real hole. Entries now match case-insensitively;
  an entry without a port matches any port, and one with a port must match it
  (a URL that omits the port counts as its protocol default).

### Patch Changes

- 798fd7a: Measure every schema-consuming package against the official JSON Schema Test
  Suite, the way `@amritk/yaml` is measured against the YAML test suite

  The required Draft 2020-12 tests (46 files, 383 groups, 1299 cases) are vendored
  under `fixtures/json-schema-test-suite`, and four packages now run them on every
  build. Each carries an expected-failure list naming every case it does not pass
  and why, and each suite fails when a case moves in **either** direction — a
  regression breaks the build, and so does a case that starts passing while its
  entry stays behind. Nothing is published: the corpus and the harnesses live
  outside every `files` list.

  | package                       | measured on                                      | rate                |
  | ----------------------------- | ------------------------------------------------ | ------------------- |
  | `@amritk/runtime-validators`  | `validate` and `validateGuard` verdicts          | 1250 / 1299 (96.2%) |
  | `@amritk/generate-parsers`    | strict parsers, generated → linked → executed    | 1180 / 1299 (90.8%) |
  | `@amritk/generate-validators` | generated predicate validators, likewise         | 987 / 1299 (76.0%)  |
  | `@amritk/resolve-refs`        | verdict preserved after inlining (`$ref` corpus) | 160 / 170 (94.1%)   |

  The generators are measured through the code they emit, not the source text they
  emit: each suite schema is generated whole, compiled, and linked in memory, so the
  `$ref`'d sibling files and the embedded runtime helpers run too. `resolve-refs`
  has no verdicts of its own, so it is held to semantic preservation — the resolved
  document must accept exactly what the original did, judged by
  `@amritk/runtime-validators` over the cases the interpreter already answers
  correctly, which is the population where a resolution bug is visible and nothing
  else is.

  Those rates are where the packages _end up_. The suites were written first and
  found real defects — a validator that accepted everything for a schema without a
  `type`, `required` satisfied by an inherited `toString`, refs that emitted
  uncompilable output, `$ref`-shaped data inlined as a reference — each fixed in its
  own commit alongside this one. What remains is documented case by case, and each
  package's README carries a "Conformance, measured" section with its number and the
  reasons behind it.

- 2c9982c: Fix the published manifests so the packages install, resolve, and dedupe correctly

  **Types resolve on TypeScript's default config.** Every package was
  exports-only: nine declared `"module": "./dist/index.js"` (a field neither Node
  nor TypeScript reads) and nothing declared `types`. A consumer on
  `moduleResolution: "node10"` — still the default when `module` is `commonjs` —
  cannot see `exports` at all, so `import { lintDocument } from '@amritk/lint'`
  failed with `TS2307: Cannot find module '@amritk/lint' or its corresponding type
declarations`. Each package with a `.` export now also declares `main` and
  `types`; `@amritk/helpers` and `@amritk/adapters` have no `.` export (they are
  subpath-only), so they declare a `typesVersions` wildcard mapping instead, which
  gives their subpaths the same node10 fallback. All of it is ignored under
  `node16`/`nodenext`/`bundler`, where `exports` still wins.

  **`workspace:*` resolves to a caret, not an exact pin.** All fourteen
  inter-package edges shipped as exact versions, so installing two `@amritk/*`
  packages published at different times pulled in two copies of their shared
  dependency. That is not merely wasteful: the module-level caches those packages
  rely on are per-copy, so the `WeakMap` validator cache in
  `@amritk/runtime-validators` silently stopped hitting. Pre-1.0 a caret stays
  narrow (`^0.9.1` is `>=0.9.1 <0.10.0`) and breaking changes here already ride a
  minor bump.

  **`@amritk/helpers` stops shipping 21 source files it does not need.** Embedded
  mode reads four helper sources (`is-object`, `validate-array`,
  `validate-record`, `has-ref`) out of the installed package at generation time,
  so `src` has to ship — but only those four. `files` now lists them explicitly
  instead of globbing all of `src`, cutting the tarball from 78 files / 206 kB to
  63 / 112 kB.

  **Two packages no longer declare a dependency they never import.**
  `@amritk/mjst` and `@amritk/generate-parsers` both listed
  `@amritk/generate-markdown` under `dependencies`, but the only importer is each
  package's `scripts/generate-readme.ts`, which is not published. Both moved to
  `devDependencies`. `@amritk/adapters` likewise dropped its
  `@sinclair/typebox` peer dependency: the TypeBox adapter is purely structural
  (it strips symbol keys) and imports nothing. `valibot` stays — it is a genuine
  transitive peer of `@valibot/to-json-schema`.

  **`@amritk/mjst` fixes.** `json-schema-typed` moved to `dependencies`, because
  the shipped `dist/emit-examples.d.ts` imports types from it. The package gained
  an `exports` map, so it is no longer deep-importable in its entirety. And the
  build now marks `dist/cli.js` executable: `npm pack` records on-disk modes, and
  package managers only `chmod` bin targets when they link them, so flows that
  consume the tarball directly (vendoring, Docker `npm pack` + `tar -x`) hit
  `EACCES`.

- 08b2833: Resolve a `#/pointer` inside an `$id` scope against the resource that declares it

  A fragment-only ref was hard-coded to resolve against the document root, so
  `{ "$id": "…/base.json", "$defs": { "inner": … }, "properties": { "x": { "$ref": "#/$defs/inner" } } }`
  nested inside a larger document reported "Cannot resolve internal `$ref`" — the
  pointer names a definition of the _embedded resource_, not of the root. It now
  looks in the resource named by the base URI in scope first, and falls back to the
  document root only when the pointer matches nothing there. The fallback is what
  keeps bundled documents working: a bundled OpenAPI file points at
  `#/components/schemas/…` from inside an `$id` scope, and when both could match the
  resource wins, which is the order the spec asks for.

  That also settles pointer-form `$dynamicRef`s (`#/$defs/items`) inside an `$id`
  scope: the spec says a `$dynamicRef` whose fragment is a pointer behaves exactly
  like `$ref`, so resolving it against its enclosing resource is right by
  construction.

  On the `$ref` corpus of the official JSON Schema Test Suite the package is at
  **160 / 170**. The corpus grew from 107 with `@amritk/runtime-validators`' `$id`
  work — it is the reference-carrying cases the interpreter answers correctly, which
  is the population where a resolution bug is visible at all. What is left is one
  documented limit: a `$dynamicRef` binds at evaluation time to the outermost
  `$dynamicAnchor` along the _dynamic_ scope, so inlining it statically collapses it
  to a single target and cannot be right in general.

- f9f790a: Stop inlining a `$ref`-shaped object that is data, not a reference

  `{ "$defs": { "a_string": { "type": "string" } }, "enum": [ { "$ref": "#/$defs/a_string" } ] }`
  references nothing. `enum` holds _instances_, and one of them happens to be an
  object with a `$ref` key — but the walk was purely structural, so it inlined that
  object and turned "the enum containing `{"$ref": …}`" into "the enum containing
  `{"type": "string"}`", changing what the document matches in both directions. The
  official suite carries the case under exactly that name: _"naive replacement of
  `$ref` with its destination is not correct"_.

  Every structural walk in the package now carries the **role** of the node it is
  at — a schema, a map of author-chosen names to schemas, instance data, or
  something outside the vocabulary. `enum` / `const` / `default` / `examples` hand
  their subtree back untouched; `properties` / `patternProperties` / `$defs` /
  `definitions` / `dependentSchemas` / `dependencies` suppress keyword reading one
  level down, so a definition legitimately _named_ `enum` is still a definition and
  a property named `$ref` is still a property — the trap in the naive version of
  this fix, which the resource registry had; and an unrecognized keyword yields
  `unknown`, which is absorbing, so OpenAPI's `components`/`paths` and `x-` vendor
  blocks are walked exactly as before.

  Two consequences beyond the inlining itself: the resource registry no longer
  registers an `$id`/`$anchor` that is part of a value or a property name, and
  `resolveRefsFromFile` no longer reads a file or opens a network connection for a
  `$ref` string sitting inside an `enum`.

  This takes the package to **107 / 107** on the `$ref` corpus of the official JSON
  Schema Test Suite, with an empty expected-failure list.

## 0.4.5

### Patch Changes

- 65771d4: Repair the workspace type check and complete the published manifests

  `bun run types:check` had been failing for three packages and nothing in CI ran
  it. `@amritk/lint`, `@amritk/runtime-validators`, and `@amritk/yaml` were the
  only tsconfigs without the `**/*.test.ts` exclude the other nine carry, so their
  test files pulled the shared OpenAPI fixture loader into the program, where its
  `@amritk/resolve-refs` / `@amritk/yaml` imports do not resolve from the repo
  root. CI now runs `types:check` alongside the lint and test steps.

  Every package declares `engines: { node: '>=20' }`, matching the Node target the
  CLI already emits for, so an install on an older runtime warns instead of
  failing at run time. Every library also declares `sideEffects: false` so bundlers
  can tree-shake them — relevant to `@amritk/runtime-validators`, `@amritk/lint`,
  and `@amritk/yaml`, which are built to ship into browsers and Workers. The CLI
  is excluded: its bin runs on import.

  `@amritk/runtime-validators` no longer depends on `json-schema-typed`. It never
  imported the package, and the dependency was installed by every consumer of the
  one package whose design goal is staying self-contained.

## 0.4.4

### Patch Changes

- 1901231: Ship AI-agent-facing docs. Each package now includes an `AI.md` in its published
  tarball — a mental model, a minimal runnable example, and the gotchas most
  likely to trip up an LLM — and gains `@example` JSDoc on its primary exports. A
  root `llms.txt` / `llms-full.txt` (generated by `bun run generate-llms`) indexes
  them, and `@amritk/mini` adds a `check:reactivity` guard for the compilerless-JSX
  "called signal" footgun.

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
