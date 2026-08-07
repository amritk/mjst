# @amritk/api

## 0.15.0

### Minor Changes

- ae367f8: `@amritk/api/bundler` ships the contract strip as a transform instead of a plugin per bundler

  **Breaking.** `stripContractsVite`, `stripContractsRollup`, `stripContractsEsbuild`, and `stripContractsBun` (and their option/plugin types) are gone. The subpath now exports `stripContractFields(source)` — the transform those four all wrapped — plus `isScannableId(id)`, the module-id filter to put in front of it. Migration is a few lines against your bundler's own per-module hook; the README carries a snippet for Vite/Rollup, esbuild/`Bun.build`, and an rspack/webpack loader.

  ```ts
  // vite.config.ts — what stripContractsVite() was doing
  import { isScannableId, stripContractFields } from "@amritk/api/bundler";

  const stripContracts = {
    name: "strip-contracts",
    enforce: "pre",
    apply: "build",
    transform(code: string, id: string, options?: { ssr?: boolean }) {
      if (
        options?.ssr === true ||
        !isScannableId(id) ||
        !code.includes("defineContract")
      )
        return null;
      const stripped = stripContractFields(code);
      return stripped === code ? null : { code: stripped, map: null };
    },
  };
  ```

  The `exclude` option has no replacement because it no longer needs one: the filtering is a condition in a hook you own, alongside whatever else you want to scope by.

  **Per-operation `security` now survives the strip.** `createClient` does not read it, but it is the one descriptive field an app plausibly reads for itself — attaching a bearer token only where a scheme is declared, skipping a call that will certainly 401, hiding a control for a scope the session lacks — and a requirement is tens of bytes against the hundreds a request schema costs. Deleting it to save that was a bad trade against silently breaking an app that read it. `summary`, `description`, `tags`, `operationId`, `deprecated`, `refine`, and the request/response schemas still go: nothing in a browser can act on them.

  The README also documents a **publish-time** strip for contracts that ship as their own package — emit the full build for the server and a stripped one for `./client`, both pointing at the same `.d.ts`. Consumers get the smaller values with the full types and JSDoc, and no bundler wiring at all.

  **Why.** A plugin per bundler is a matrix that is permanently one entry behind — a build on rspack found four plugins and no fifth, and Turbopack, Farm, and Rolldown queue up behind it. The transform is the whole asset (the parser, the conservative bail-outs, the line-preserving rewrite); the wrappers were ~10 lines each of hook shape that the bundler's own docs describe better. Nothing changes about what gets stripped or the ~75% of contract bytes it removes, and the size test now bundles through the documented `Bun.build` wiring, so the snippets are covered rather than merely written down.

  Two clarifications, since the plugins were being reached for to solve something they cannot: the strip is a size optimization only, and it is not the way to keep `node:*` out of a browser bundle — bundlers resolve modules before eliminating them, so an unresolvable built-in fails the build before any tree-shaking runs. Contracts files should import `defineContract` from `@amritk/api/client`, whose import graph is guaranteed free of server modules and `node:*` by a test.

## 0.14.0

### Minor Changes

- fb67e63: Support magic-link auth from native apps, where the client has no cookie jar.

  Two new exports, both for failures that present to a developer as "bad token":

  - **`exemptBearer`** — a `createCsrf({ exempt })` predicate. A native client can
    neither receive the seeded `csrf_token` cookie nor echo it back, so every
    unsafe-method call from one took a `403`. Keying the exemption on the
    `authorization` header is what makes it safe: a page on another origin cannot
    attach one without a preflight the server never grants. Shipping it as an
    export exists to head off the intuitive alternative — exempting requests with
    no `Origin` — which looks equivalent and is a bypass, since same-site form
    posts routinely omit `Origin`.
  - **`createBearerSession`** (also on `@amritk/api/client`) — the
    stored-session-token model, filling the gap between the two existing helpers.
    It wraps `fetch` rather than providing `headers`, because both halves of the
    bearer model need to see responses: it attaches the stored token, captures a
    newly issued one off `set-auth-token`, and on a `401` either runs an optional
    single-flighted `refresh` and replays **under the new token**, or clears
    storage and fires `onExpired`. `refresh` is usually unnecessary — a server-held
    session keeps a stable opaque token and rolls its expiry forward in the
    database once a request arrives past `updateAge`, so sending the token is the
    renewal. `storage` is required and undefaulted so an in-memory fallback cannot
    look correct until the app relaunches and signs everyone out.

  That replay is the trap the helper exists to close: `createRefreshFetch` can
  replay an untouched `RequestInit` because the browser re-attaches the freshly
  `Set-Cookie`'d session itself, and nothing does that for a bearer token — reusing
  the original init would present the dead token and `401` again.

  Also documents the flow end to end. The Better Auth guidance was browser-shaped
  throughout — it forwarded only `cookie` into `getSession`, so a `bearer()`
  session silently resolved to `null` and every guard denied with its declared 401.
  The new "Native apps" section covers the deep-link `callbackURL` and
  `trustedOrigins` (and why a custom scheme belongs there rather than in
  `createCors`, which has no `Origin` to negotiate with a native caller), the `302`

  - `Set-Cookie` passing through the mount untouched, forwarding both `cookie` and
    `authorization` into `getSession`, and says outright that the CSRF exemption
    covers bearer callers only rather than leaving the Expo cookie shape to fail
    quietly.

## 0.13.0

### Minor Changes

- 299ed2a: Keep the runtime pipeline synchronous when the request never suspends

  **`Api.handle` now returns `ApiResponse | Promise<ApiResponse>`.** It answers
  synchronously when nothing along the route's path was asynchronous — no
  declared body to read, no `refine`, no context factory, no guards, and a
  handler that returned a value rather than a promise. This is the breaking part:
  `await api.handle(...)` is unaffected, but code calling `.then()` on the result
  directly must handle a plain value. The bench harness in this repo did exactly
  that and is updated alongside.

  **Why.** An `async` frame and its promise are not free, and on workerd the
  difference is large enough to see. On the static GET, measured inside a real
  isolate with `bench:workerd:allocations`, the runtime engine allocated 2115
  bytes per request; it now allocates 1510, a 29% cut. Throughput on that case
  went from ~69k to ~93k ops/s — from 0.80x bare Hono to roughly level with it.

  **How.** `runRoute` is no longer one async function. It is a synchronous
  dispatcher over three stages that hand off to each other synchronously until
  something genuinely asynchronous appears:

  - `runSecuredRoute` — security guards suspend before anything else happens, so
    that whole shape stays asynchronous, and rejoins the shared stages after.
  - `runSlots` — coercion and validation for params, query, headers, and cookies,
    all of which were already synchronous.
  - `runBody` — reading a declared body always suspends, so this stage is
    unconditionally asynchronous.
  - `runTail` — refine, the context factory, guards, and the handler. Synchronous
    when none of the first three are configured and the handler returns a value;
    otherwise it delegates to `runTailAsync`, which is the original straight-line
    code.

  The error tail is factored into one `routeError` helper the synchronous and
  asynchronous halves share, so the two cannot drift on payload-too-large
  detection or the `onError` contract. `finishReply` stays outside the error
  boundary in both, exactly where it was.

  **What did not change.** Ordering is identical: security guards still run
  before any parsing, the context factory still runs after validation on
  unsecured routes and before it on secured ones, and it still runs exactly once
  per request. The differential corpus that holds the runtime and compiled
  engines observationally identical passes unchanged.

  **Still open.** The runtime engine's batch-time distribution is still bimodal
  under workerd — a p95 around 3.3x its median, which is a major collection
  rather than allocation volume. Neither the async work above nor removing
  response validation moved it. The compiled engine, which is the production
  path, does not show it.

- 0d4bed2: Security and correctness fixes across the compiled engine, the fetch adapter, and the hook helpers.

  - **`compileToModule` no longer interpolates contract strings into generated source unchecked.** Response status keys, `bodyType`, `method`, and `maxBodyBytes` are validated at emit time and emitted from narrowed values, so a programmatically-built contract (from a config file, a database row, an imported OpenAPI document) can no longer inject code into the module that ships. `defineRoute`/`defineContract` are identity functions with no runtime validation, which is what made this reachable.
  - **Guards added or removed after a compile are no longer silently unenforced.** `hashContracts` now fingerprints the _presence_ of `guards`, `securityGuards`, and `refine` (their bodies are still excluded, so rewriting one is not staleness), and the emitted module additionally **throws** at init when that shape drifted — a deploy that fails loudly beats one that quietly stops checking credentials. Ordinary schema drift keeps warning and keeps serving.
  - **The compiled engine honours the `raw` escape hatch on the error paths.** An `onError` or `errors.*` formatter returning `raw(response)` used to lose its body in the compiled module while the runtime engine sent it.
  - **`createETag` enforces `maxBytes` while reading** instead of buffering the whole body first. A large streamed reply was fully buffered just to discover it was over the limit; the cap now bails mid-read and passes the response through without losing already-read chunks.
  - **A throwing `onRequest`/`onResponse` hook becomes the pipeline's 500** in both engines instead of escaping to the platform (a Workers 1101, a Bun unhandled rejection).
  - **New `writableResponse` export**, used by `createCors`, `createCsrf`, `createRateLimit`, and `createRequestId`. A `Response` from a proxying mount has immutable headers, so mutating them directly threw — and per the previous point, that throw cost the whole reply.
  - **`createDocs` escapes `cdn` and `integrity`**, pins the Scalar bundle version (new `SCALAR_VERSION` export and `version` option) instead of floating on `@latest`, and accepts an `integrity` option for subresource integrity.
  - **`signCookie`'s imported-key cache is bounded**, so a per-tenant secret-rotation loop no longer retains a `CryptoKey` per distinct secret forever.
  - **The package root no longer pulls `node:*` into a Workers or browser bundle.** `node:http`, `node:stream`, and `node:events` reached the root entry through the Node adapters and broke `esbuild --platform=browser` outright (resolution runs before tree-shaking). The adapters now load their built-ins on demand and `waitForDrain` dropped `node:events` entirely; a graph-walking test over `index.ts` pins the invariant.

### Patch Changes

- a342117: Close a compiled-engine validation bypass, and stop dropping `__proto__`-named headers and path parameters

  **`compileToModule` baked its schema constants as object literals, which is not
  a faithful copy of the JSON they were printed from.** A JavaScript object
  literal treats `__proto__` as the prototype setter, so a contract declaring a
  property under that name — perfectly ordinary in a schema loaded from a config
  file, a database row, or an imported OpenAPI document, where the key really is
  an own property — compiled to a constant with that property silently missing.
  The compiled engine then validated a schema the runtime engine never had, and
  diverged in both directions: it rejected `{"__proto__":"abc"}` under
  `additionalProperties: false` that the runtime accepted, and accepted
  `{"__proto__":123}` against `{"type":"string","minLength":3}` that the runtime
  rejected. The second is a validation bypass in the production engine — the
  declared constraint was simply gone.

  Every constant baked from contract data — request schemas for all five slots,
  response body and header schemas, and the interpreter's options — now emits as
  `JSON.parse('…')`, where each key lands as an own property. The argument is a
  correctly-escaped single-quoted string literal (backslashes, single quotes, and
  U+2028/U+2029, which are legal unescaped in JSON but were line terminators in
  pre-ES2019 JavaScript source), pinned by a round-trip test over hostile input.
  There is no startup cost: a JSON string literal evaluates about 13% faster than
  the equivalent object literal at module init on a 46 KB schema, and the emitted
  module grows by 14 bytes per constant (0.6% on a realistic module). The
  precomputed OpenAPI document was never affected — it was already a string
  literal.

  The differential corpus gained a route declaring `__proto__` as its path
  parameter, header, cookie, _and_ body property at once, so the two engines are
  now pinned to agree on the correct answer for all of them, and the emitter has
  an invariant test that no schema constant may be a bare object literal.

  **Headers and path parameters named `__proto__` are no longer dropped.** The
  same write-side bug the cookie parser had: `__proto__` is a valid HTTP field
  name (it is a token) and a valid path-template capture name, but a plain
  `record[name] = value` runs the prototype setter instead of creating the
  property. A contract declaring one saw nothing, and `required: ['__proto__']`
  could never be satisfied. Fixed in the route matcher, the params builder, and
  the headers builder through a shared `defineOwnProperty`, which the cookie
  parser now shares too; the compiled engine unrolls its own params and headers
  builders, so it emits the equivalent `Object.defineProperty` for that one name
  and pays nothing for every other.

  Also: the schema-derived response serializer now declines any property whose
  name shadows an `Object.prototype` member, falling back to `JSON.stringify` —
  its `body["<key>"]` reader would otherwise answer with the inherited member
  rather than `undefined` when the reply omits the property, so a `__proto__`
  property serialized as `{}` and an optional `toString` was emitted on every
  reply. This is the same bail the inline guard emitter already made, and the two
  now share one list of risky names.

- f5a52b7: Report thrown adapter hooks instead of swallowing them, and stop dropping a `__proto__` cookie

  **A throwing `onRequest` gate or `onResponse` decorator is no longer silent.**
  Wrapping the hook chains stopped a throwing hook from escaping to the platform,
  but the caught error was then dropped on the floor: no log, and the app's own
  `onError` — which every routed failure already goes through — was never
  consulted. The motivating case is exactly the one that needs telemetry:
  `createRequestId({ trustInbound: true })` reflecting a CRLF-bearing inbound
  `x-request-id` into `Headers.set` answered a bare `{"error":"internal_error"}`
  with no indication that a decorator threw, or which one. Before the wrapping the
  throw at least surfaced as a platform-level unhandled error, so the fix traded a
  crash for an undiagnosable 500.

  A thrown hook now goes to the app's `onError` (with `route: undefined` — a hook
  belongs to no route), whose reply shapes the response exactly like a handler
  error's does, raw-`Response` escape hatch included. An app that wired no
  `onError` gets a `console.error` instead, because silence is the one outcome
  that is never acceptable here; a reporter that throws falls back to the same log
  and the bare 500. `Api` gained an optional `onError` so the adapter can reach the
  sink the app already configured — the hooks run outside `handle`, so the
  pipeline's own boundary never sees them. `compileToModule` emits the identical
  helper, and the two-engine differential corpus now pins that both engines report
  the same error, through the same sink, with the same log line.

  **A contract declaring a cookie named `__proto__` now actually receives it.**
  The read side treated the name as ordinary data, but the write side was a plain
  `cookies[name] = value`, which runs `Object.prototype`'s `__proto__` setter
  rather than creating a property — so the value silently vanished and
  `required: ['__proto__']` failed for every request no matter what the client
  sent. Same `defineProperty` fix already applied in `@amritk/generate-validators`
  and `@amritk/yaml`. Both engines share this parser, so the compiled engine picks
  it up unchanged.

- 365c6c1: Bucket route dispatch by shape, and fix two request-parsing defects

  **Route lookup no longer scans every parameterized route.** The runtime engine
  kept one list of dynamic routes per method and walked it in registration order,
  re-running the segment matcher against each candidate. At 500 routes that was
  ~7.3 µs per lookup, and a miss cost the same as a hit. Dynamic routes are now
  bucketed by segment count and by their first literal segment, so a lookup only
  ever touches candidates that could match the shape in front of it: ~0.55 µs at
  500 routes, and flat as the table grows. Precedence is unchanged — the buckets
  are precomputed with the wildcard-first routes merged into each literal's list
  in registration order, so which of two overlapping routes wins is exactly what
  it was, greedy tails and static-over-dynamic included.

  **An unroutable path is no longer the most expensive request an API serves.**
  Building the 405 `allow` header re-ran the _whole_ matcher once per method the
  API declares, so a path from a vulnerability scanner cost up to seven times the
  scan — ~45 µs of pure dispatch on a 500-route table, versus ~3 µs to serve a
  real request. The static half of that answer is now precomputed at startup (the
  same table the compiled engine emits as `ALLOW_STATIC`) and the dynamic half
  reuses one path split across all methods: ~0.9 µs. The static hit path also
  stopped building a `method + ' ' + path` key per request.

  **Duplicate cookie names now resolve first-wins, not last-wins.** Browsers send
  the most specific cookie first (RFC 6265 orders by longer path, then earlier
  creation), so a `Path=/` cookie planted from a sibling subdomain arrives _after_
  the real session cookie — and last-wins let it shadow it. First-wins is what the
  `cookie` package behind Express, Hono, and Fastify does, and what the rest of the
  stack assumes. Both engines share this parser, so they stay identical.

  **`buildParamPath` rejects `.` and `..` path parameters.** Dots are unreserved,
  so `encodeURIComponent` left them alone and `client.getUser({ params: { id:
'..' } })` built `/users/..`, which the URL parser then collapsed _before the
  request was sent_ — the call silently hit a different endpoint. It now throws.
  Greedy `{name+}` tails are checked per segment for the same reason: WHATWG URL
  normalizes `%2e%2e` too, so a literal `..` path component cannot be transmitted
  at all, which makes one there always an unintended traversal rather than a
  directory name.

  The bench harness gains two dispatch cases — `dynamic GET, 500-route table, last
match (runtime)` and `unroutable path, 500-route table (runtime)` — so the PR
  delta table catches a regression in either.

- 2eed2e5: Stop paying for an AbortSignal on every request, and re-measure the cross-framework tables

  **Both engines materialized a host-backed `AbortSignal` per request.** The
  per-request `ApiRequest` was built with `signal: request.signal`, read eagerly.
  On workerd that first touch constructs a host object backed by C++ state —
  cheap in bytes, expensive to collect — for handlers that overwhelmingly never
  look at it. Hono never creates one at all. Reading it through a getter defers
  the cost to the handlers that actually want it. `hookApiRequest` still reads it
  eagerly: that path runs once per 500 and hands its object straight to an
  `onError` reporter.

  **The getter has to be inherited, not owned.** An own accessor pushes the
  object out of V8's in-object slots. The compiled engine's request object had no
  accessor before this change, and gaining one took it from 852 to 1276 bytes
  allocated per request inside workerd. On a shared prototype the instances stay
  plain data objects and the deferral is free. Both engines get the same
  treatment, as the differential corpus requires.

  **Measured, not inferred.** The README previously reported that workerd stalled
  the `@amritk/api` columns far more often than Hono and guessed the cause was
  allocating more per request. That guess was wrong: on the static GET the
  compiled engine already allocated 852 bytes per request against bare Hono's
  1220, and turned a batch of 2048 requests around faster than Hono did. It
  allocated less and ran quicker, then periodically got stopped. After the fix it
  allocates 816 bytes per request and stalls on 0 of 60 batches, where before it
  stalled on 5 and lost 29% of its wall clock to them. The runtime engine still
  stalls and still allocates ~2172 bytes per request; that is called out in the
  README as open work rather than presented as solved.

  **New: `bun run bench:workerd:allocations`.** Reads the isolate's heap over
  workerd's inspector either side of a run of exactly N requests and regresses
  the delta against N, so the Miniflare loopback hop lands in the intercept and
  cancels; it also times fixed batches inside the isolate and reports how many
  ran more than twice the median. workerd accepts `HeapProfiler.startSampling`
  but answers with an empty profile, so there is no per-call-frame attribution to
  be had from the runtime. `bench/run-workerd.ts` now repeats each cell across
  several fresh isolates and reports the median of the per-isolate medians —
  a single isolate's median is robust to a paused trial, but isolates differ from
  each other by more than that, which was enough to hide effects this size.

  **The cached-`ResponseInit` comment claimed ~40% and was measured on neither
  runtime it gets read on.** Measured now: on Node it is worth about 10% on the
  static GET (104k vs 93k ops/s against `Response.json`); inside workerd the
  cached init, a cached `Headers` instance, and plain `Response.json` are
  indistinguishable. The code stays — it costs nothing anywhere and helps on one
  runtime — but the comment now says so.

  All three tables were re-measured together on one machine, which is slower than
  the one earlier revisions used, so the absolutes moved down across every column
  at once. The README says that where the tables are.

- ef77708: Reject `NaN` against a numeric bound, matching `@amritk/runtime-validators`.

  Bounds were emitted as their direct failure condition (`x < minimum`) rather than
  the negated pass condition (`!(x >= minimum)`). The two agree on every ordinary
  value and are opposite for `NaN`, which compares `false` against every operator:
  the direct form read that as "not out of bounds" and let a `NaN` through
  `minimum` / `maximum` / `exclusiveMinimum` / `exclusiveMaximum`, where the
  interpreter and Ajv both reject it. Generated validators, strict generated
  parsers, and the compiled API engine's inlined guards all now write the negated
  form — so a `NaN` fails a bounded number everywhere in the toolchain. A bare
  `{ type: 'number' }` with no constraint still accepts it, as Ajv does; only a
  bound or `multipleOf` rejects it.

  Two internal inconsistencies close with it: `@amritk/generate-parsers` emitted the
  un-negated `x >= min` in its inline matchers and the direct `x < min` in its
  strict assertions, so the same schema could answer differently depending on which
  path ran, and `@amritk/api`'s compiled engine disagreed with its own runtime
  engine for a value the two are documented to be observationally identical on.

  `interpreter-parity.test.ts` now covers the numeric keywords — bounds, the
  draft-04 boolean `exclusive*` form, and `multipleOf` across integer, fractional,
  and quotient-overflowing divisors — over a value set built to separate the two
  spellings (`NaN`, `±Infinity`, `1e308`, `1000000.005`). Nothing pinned these
  before, which is how the drift got in.

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

- Updated dependencies [213ecc4]
- Updated dependencies [798fd7a]
- Updated dependencies [2c9982c]
- Updated dependencies [bc09e15]
- Updated dependencies [b152c4e]
- Updated dependencies [15e480e]
- Updated dependencies [140412b]
  - @amritk/runtime-validators@0.10.0

## 0.12.0

### Minor Changes

- dd8f407: Add a browser-safe `@amritk/api/client` subpath and shave the client's fixed cost by making every non-JSON wire piece opt-in.

  - **New `@amritk/api/client` entry point** — `createClient`, `defineContract`, the opt-in serializers (`toSearchParams`, `appendCookies`, `buildParamPath`, `formBodySerializer`, `multipartBodySerializer`), the error predicates, the `…Of` type helpers, and the client-side auth helpers (`createCsrfHeader`, `createTokenRefresh`, `createRefreshFetch`, `decodeJwtExpiry`). Its import graph never touches a server module (enforced by a test), so bundlers resolve zero `node:*` built-ins and print zero externalization warnings — browser safety no longer depends on `sideEffects: false` tree-shaking. The root barrel keeps exporting everything.
  - **Breaking: query serialization is opt-in**, matching the existing `pathParams` pattern. Calls that pass `query` need `queryParams: toSearchParams` in `createClient` options; a call without it throws with the fix in the message. JSON-only apps that never send query strings no longer bundle the serializer.
  - **Breaking: the `cookies` slot is opt-in** for the same reason — register `cookies: appendCookies` (Node/undici/workers only; browsers forbid setting the `cookie` header, so a browser bundle could never use it and now never carries it).
  - The two client error modules merged into one (`client-errors`) with a shared constructor, halving their scaffolding bytes. `malformedBodyError` / `unexpectedStatusError` and their predicates behave exactly as before and stay exported from the root.

## 0.11.0

### Minor Changes

- dcc2ea4: Let `@amritk/api` assert string formats, and document where `format` is ignored

  `format` is an annotation in JSON Schema, and both Ajv and
  `@amritk/runtime-validators` make asserting it opt-in. `@amritk/api` never opted
  in and offered no way to, so a route declaring
  `{ type: 'string', format: 'uuid' }` accepted any string — while the README said
  the format "still applies". Short of replacing the whole engine through
  `compile`, there was no way to get the check.

  Both engines now take `formats`, matching the interpreter's own option:

  ```ts
  createApi({ routes, formats: "all" });
  createApi({ routes, formats: ["uuid", "email"] });
  compileToModule({ routes, routesImport, formats: "all" });
  ```

  A violation is an ordinary `400 { error: 'validation_failed' }`. Pass the same
  value to both engines so the compiled module and the development server agree;
  the option is ignored when a custom `compile` is supplied, since that replaces
  the engine it configures. Default behavior is unchanged — `format` stays an
  annotation until you ask.

  In the compiled engine a schema carrying `format` leaves the inlinable subset
  and falls back to the interpreter, which owns the format regexes, rather than
  the emitter growing a second copy of each. Engine-for-engine equivalence is
  covered by a new differential case.

  `@amritk/generate-validators` emits no `format` check either, and that was
  nowhere in its docs — a real divergence from the interpreter as `@amritk/lint`
  runs it (`formats: 'all'`). Now stated in the README, AI.md, and AGENTS.md, with
  a test pinning it, and the benchmark section no longer claims every library does
  the same work on the two rows whose schemas declare `format`.

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

- Updated dependencies [65771d4]
  - @amritk/runtime-validators@0.9.1

## 0.10.0

### Minor Changes

- 42fdea2: **Breaking (types):** the raw-`Response` escape hatch is now `raw(response)`
  instead of a bare `Response`. Returning a `Response` directly from a handler or
  guard is a type error; wrap it — `return raw(response)` — or, if you build the
  reply object yourself, `return { raw: response }`. The new `raw` helper and the
  `RawReply` type are exported from `@amritk/api`. Neither engine sends a bare
  `Response` any more, so this must be updated at the call site.

  This fixes a silent type-inference regression introduced in 0.7.0 with the
  escape hatch itself: from 0.7.0 through 0.9.0, an ordinary reply whose `status`
  came from a union was rejected, even when the contract declared every one of
  those statuses. The common shape is forwarding an upstream result:

  ```ts
  type EmbedResult = { ok: true } | { ok: false; status: 502 | 503; error: string }

  const embed = await triggerEmbed(...)
  // 0.7.0–0.9.0: error TS2345, "Type '502' is not assignable to type '503'",
  // though `responses` declares 502 and 503. Compiles again in 0.10.0.
  if (!embed.ok) return { status: embed.status, body: { error: embed.error } }
  ```

  `Response.status` is a plain `number`, so a bare `Response` in the return union
  matched on `status` for every declared status and forced the reply to be
  assignable to `Response` as well — reported as a misleading status mismatch.
  `RawReply` (`{ readonly raw: Response }`) carries no `status`, so the reply
  union's discriminant survives and such replies infer normally. Consumers who
  worked around this — casting the status, splitting the return into a branch per
  status, or annotating with `RouteReplyOf` — can drop the workaround.

  The runtime is unchanged: `ApiResponse` already carried `raw?: Response` and the
  adapters already branched on it, so the escape hatch still sends the response
  verbatim, skips response validation, and strips the body for HEAD, through the
  fetch adapter, the Node adapter, and the compiled engine alike. Making the
  opt-out explicit at the call site is a deliberate second benefit: `raw(r)` reads
  as "this reply leaves the contract" where a bare `return r` did not.

## 0.9.0

### Minor Changes

- 6191ec9: Add hot reloading for the development server through a new `@amritk/api/dev`
  entry: `createHotApi`, `watchPaths`, and `importFresh`. The dev server keeps its
  socket, its connections, and everything living outside your route modules while
  the route table, validators, and OpenAPI document are rebuilt from disk on every
  save — no restart, no in-memory state lost between edits.

  `createHotApi({ load, watch })` returns a normal `Api`, so it is handed to
  `toFetchHandler` / `toNodeHandler` once and never mentioned again; the build
  underneath it is swapped atomically, and in-flight requests finish against the
  build they started on. A broken edit does not take the server down — the previous
  build keeps serving, with the reason logged and kept on `api.error()` — and a
  failure before the _first_ build still binds the port, answering
  `503 {error:'not_loaded'}` with the error instead of exiting. Reloads that arrive
  mid-build coalesce into one follow-up pass, so a branch switch costs one extra
  build rather than one per file. `reload(changed?)`, `close()`, and `generation()`
  round out the surface.

  `watchPaths(paths, options?)` is the debounced filesystem watcher (recursive,
  `node_modules`/`dist`/dotfile-aware, extension-filtered), and it is only the
  default implementation of the `watch` seam — anything shaped
  `(onChange) => dispose` fits, including a bundler's watcher or a test's manual
  trigger. `importFresh(specifier, options?)` is the module re-import that lets
  `load` see new code: on Node 22.15+ it re-evaluates the **whole local graph**
  (a `node:module` resolve hook scoped to `root`, so dependencies are never
  re-evaluated), and elsewhere the named module.

  The entry is development-only and one-way — it imports the runtime, never the
  reverse — so `node:fs` watching and module re-importing stay out of the graph
  that ships to Workers and browsers.

- e072b47: Add `openApiGuards` to `createApi` and `compileToModule`, gating the served
  OpenAPI document. The document endpoint is answered before route matching, so
  `secureRoutes` never covers it — without this the full schema stayed public under
  an otherwise deny-by-default API. The guards run exactly like a route's security
  guards: the context factory first, then each guard in order with the first denial
  winning, and the denial is sent as-is. The compiled engine names them by export —
  `openApiGuardExports: ['requireSession']` — like its other hook options.

  `OnErrorDetails.route` is now `AnyRouteContract | undefined`. It is `undefined`
  only for an error raised on the guarded document path, which has no route behind
  it; an `onError` that reads `details.route.path` needs a `?.` to keep
  type-checking.

- 2b74018: Add `secureRoutes` for deny-by-default authorization. It resolves each route's
  OpenAPI `security` requirement — its own, or a document-level default — into the
  guards that enforce it and attaches them as the route's `securityGuards`. Schemes
  carry their guard under an `x-guard` extension (the exported `securityGuard`
  key), so one declaration drives both the OpenAPI document and runtime
  enforcement; the guard is stripped from the generated document.

  AND/OR requirement semantics follow OpenAPI (the first alternative's denial is
  what the client sees), a requirement's scopes reach the scheme's guard as its
  second argument, and a public route opts out with `security: []`. Security guards
  run before slot validation, body reads and `refine` — after the context factory,
  so they can gate on the session — which keeps an unauthenticated caller away from
  the parser, the schema error detail and app code.

  Four fail-closed startup errors keep the document and the runtime in agreement: a
  requirement naming an undefined or guard-less scheme; an empty requirement object
  (`{}`, OpenAPI's "auth optional" — opt in with `allowOptionalSecurity`); a guard
  whose denial status the route's `responses` omits (opt out with
  `allowUndeclaredDenials`); and calling `createApi`/`compileToModule` with a
  `security` default covering a route that never went through `secureRoutes`.

  Because the guards land on `contract.securityGuards`, both the runtime and
  compiled engines honor them unchanged.

## 0.8.0

### Minor Changes

- 2e757e3: Add route guards for per-endpoint authorization. Declare `guards: [...]` on
  `defineRoute`, `implementRoute`, or `routeImplementer` (server side — the
  browser-safe `defineContract` stays pure data); each guard runs after the
  context factory and before the handler, sees the same `RequestContext` the
  handler will, and either returns a reply to deny the request or `undefined` to
  pass. Guards run in order (first denial wins), may be sync or async, and a
  thrown guard takes the `onError` path. A guard can only deny with a status the
  route's `responses` map declares, so enforcement can never silently open an
  endpoint and the 401/403 is already in the OpenAPI document. Guards attach in
  one place — the `guards` field — and the denial status stays declared on the
  contract, so OpenAPI, response validation, and the typed `createClient` all
  agree. `requireContext` packages the common reusable session/role check; declare
  a shared `authResponses` fragment once to keep the boilerplate DRY. Both the
  runtime and compiled engines run guards identically, pinned by the differential
  corpus.

### Patch Changes

- d0a6e99: Security hardening for the auth helpers, plus reference docs for the built-in
  security hooks.

  - **`createTokenRefresh`** — `invalidate()` (and `dispose()`) now win a race
    against an in-flight background refresh. Previously, a refresh already on the
    wire when the caller invalidated would repopulate the token on resolve,
    silently undoing a logout or a post-401 drop. A generation guard makes the
    in-flight refresh discard its result instead of resurrecting the token.
  - **`createCsrf`** — the seeded `csrf_token` cookie now defaults to
    `Path=/; SameSite=Lax; Secure` (was missing `Secure`), so the double-submit
    token never rides a plaintext request; drop `Secure` via `cookieAttributes`
    for a plain-HTTP dev origin. The gate now rejects empty tokens explicitly, so
    a blank cookie/header pair can never satisfy the equality check.
  - **`createRateLimit`** — documented that the default key derives from
    client-supplied, spoofable IP headers and must not be relied on for a
    security throttle without a trusted proxy; use a proxy-verified IP or an
    authenticated `locals` user id for login/brute-force limits.
  - **Docs** — README now has a "Built-in security hooks", "Signed cookies", and
    "Client-side auth refresh" reference covering `createSecurityHeaders`,
    `createCors`, `createRateLimit`, `createCsrf`/`createCsrfHeader`,
    `signCookie`/`createSignedCookies`, `createTokenRefresh`, and
    `createRefreshFetch`; AI.md gains a compact security-helper summary.

- a09134f: Fix four HTTP-layer correctness bugs surfaced by a review of `@amritk/api`.

  - **`multipartBodySerializer`** — a repeated field carrying files (the
    multi-file upload case, `{ files: [file1, file2] }`) was `String`-coerced to
    `"[object File]"` per item, silently dropping the uploads. `Blob`/`File`
    items inside arrays are now kept intact; only non-blob items are stringified.
  - **`createETag`** — the default hash ran over `TextDecoder.decode(body)`,
    which maps every invalid UTF-8 byte to U+FFFD, so distinct binary bodies
    could collapse to the same string and share one _strong_ ETag — yielding a
    spurious `304` that serves stale bytes. The default now hashes the raw bytes
    (`fnv1aHexBytes`); ASCII bodies are unaffected.
  - **`createCompression`** — `Accept-Encoding` negotiation was a substring test,
    so it treated `gzip;q=0` (an explicit refusal) as acceptance and ignored a
    bare `*`. It now parses RFC 9110 `q`-weights and honors the `*` wildcard.
  - **`coercePrimitive`** — a numeric path/query/header value of `Infinity` or
    `-Infinity` was coerced to a non-finite `number` that passed the type guard
    and then serialized back out as JSON `null`. Non-finite values now stay
    strings so the validator rejects them; finite forms (including exponential
    notation) still coerce.

- 217cb66: `FromSchema` now honours the `x-mjst` `brand` hint, so branded ids reach the API
  boundary.

  - **`@amritk/runtime-validators`** — a schema carrying
    `'x-mjst': { brand: 'UserId' }` now infers `Base & { readonly __brand: 'UserId' }`
    (e.g. `string & …`), matching the `.d.ts` shape the code generators already
    emit. Branding stays type-level only — runtime validation still checks the
    plain base type — and `null` remains assignable when a `nullable` schema is
    branded.
  - **`@amritk/api`** — because route `params` / `query` / `body` are typed through
    `FromSchema`, a branded param schema now flows a nominal id into the handler and
    the derived typed client, so a `UserId` can't be passed where an `OrderId` is
    expected. The same protection Drizzle's `.$type<UserId>()` gives a column, at
    the API boundary.
  - **Docs** — the `x-mjst` reference now documents the `brand` hint (a new
    "Nominal brands" section in `@amritk/adapters`), with recipes in the
    `@amritk/api` README/AI.md and the `@amritk/runtime-validators` type-inference
    docs, plus the `mjst-extension` subpath in `@amritk/helpers`.

- Updated dependencies [217cb66]
  - @amritk/runtime-validators@0.9.0

## 0.7.0

### Minor Changes

- d5282f8: Let a routed handler return a raw web `Response` as a first-class escape hatch.
  A handler may now return a `Response` directly instead of a `{ status, body }`
  reply; both engines (runtime and compiled) and both adapters (`toFetchHandler`,
  `toNodeHandler`) send it verbatim — still through `onResponse` decorators, with
  the body stripped for HEAD — and response validation is skipped since there is
  no framework-level body to check. This removes the need for a `Response`→reply
  adapter when porting handlers that already build `Response` objects.
- 3c3611c: Add client-side auth-refresh helpers for `createClient`, covering both the
  bearer-token and HttpOnly-cookie models. Nothing changes for existing
  `createClient` users.

  **Bearer tokens** — `createTokenRefresh` plugs into `createClient({ headers })`
  and renews a token on its own clock over one single-flight primitive: concurrent
  calls on an expired token queue behind one shared refresh, and a token nearing
  expiry is renewed in the background (under traffic or on an idle timer) so auth
  stays seamless. JWTs are zero-config (the `exp` claim is decoded automatically,
  via the exported `decodeJwtExpiry`); an `expiry` override or an explicit
  `{ token, expiresAt }` from `refresh` covers opaque and OAuth-style credentials.

  **HttpOnly cookies** — `createRefreshFetch` wraps `createClient({ fetch })` so an
  expired session refreshes and the request replays once, single-flighted, keyed on
  a real `401` (also catching early server-side revocation). `createCsrfHeader`
  echoes the non-`HttpOnly` `csrf_token` cookie in the `x-csrf-token` header, the
  client half of the double-submit pair `createCsrf` checks on the server. Together
  with `fetchOptions: { credentials: 'include' }` the browser holds no token at
  all.

## 0.6.1

### Patch Changes

- 1901231: Ship AI-agent-facing docs. Each package now includes an `AI.md` in its published
  tarball — a mental model, a minimal runnable example, and the gotchas most
  likely to trip up an LLM — and gains `@example` JSDoc on its primary exports. A
  root `llms.txt` / `llms-full.txt` (generated by `bun run generate-llms`) indexes
  them, and `@amritk/mini` adds a `check:reactivity` guard for the compilerless-JSX
  "called signal" footgun.
- 019ecbc: Security hardening for two request-facing surfaces.

  **SSE frame injection.** `formatSse` now sanitizes newlines per the SSE line
  grammar (CR, LF, and CRLF all terminate a line), closing an injection hole a
  handler hit whenever it streamed user-controlled strings. Previously `data`
  split only on `\n`, so a lone `\r` was emitted verbatim and the browser parsed
  it as a line break — letting attacker text forge extra `data:` fields, or via
  `\r\r` terminate the event and forge a whole new one. The single-line `event`
  and `id` fields were not sanitized at all, so a newline in either injected
  arbitrary fields/events. Now `data`/`comment` split on CR/LF/CRLF into repeated
  fields and `event`/`id` have any CR/LF stripped.

  **Rate-limit store memory bound.** The default in-process `memoryRateLimitStore`
  is now bounded: it trims to a target size once it crosses a hard ceiling. A
  flood of distinct keys — trivial when the key derives from a spoofable header
  such as `x-forwarded-for` — previously grew the map without bound (memory
  exhaustion) and, because a sweep can only drop already-expired entries, turned
  every subsequent insert into a full O(n) scan that freed nothing (CPU
  exhaustion). Eviction is oldest-first with hysteresis, so maintenance amortizes
  to O(1) per request.

- e197c0c: **lint:** Expose the core type surface on a dedicated `@amritk/lint/types`
  subpath export and stop re-exporting those types from the main entry. Runtime
  values and the engine/plugin/ruleset types still come from `@amritk/lint`; the
  data-model types (`IDiagnostic`, `RulesetDefinition`, `JsonPath`, `ISource*`,
  `DiagnosticSeverity`, …) now import from `@amritk/lint/types`. This replaces the
  barrel `export *` re-exports with named exports sourced from a single types
  module.

  **api (docs):** The contract/client examples now use a single `contracts`
  object and named imports throughout instead of `import * as contracts` — the
  build-step example collects the individually-exported routes into a record the
  same way, so the documented usage no longer relies on namespace imports.

- Updated dependencies [1901231]
- Updated dependencies [b4cd20a]
  - @amritk/runtime-validators@0.8.0

## 0.6.0

### Minor Changes

- d82bae9: Close a batch of capability gaps found migrating a real admin dashboard onto
  `@amritk/api` and `@amritk/mini`, all backward-compatible.

  **`@amritk/api`**

  - **All-optional query (and cookie) slots are optional at the call site.** When
    every property of a declared `query`/`cookies` schema is optional (no
    `required`), the slot — and, when it is the only declared slot, the whole
    input argument — is now optional in `ClientInput`, folded into `RequiredKeys`
    the same way a fully-absent slot already is. A GET whose query params are all
    optional type-checks as `client.listThings()`. `params` (the path needs them)
    and `body` (declaring it makes a body required) stay strictly required.
  - **Raw `text` / `bytes` request bodies.** `bodyType` gains `'text'` and
    `'bytes'`: the body is validated verbatim against the schema and handed to the
    handler as a `string` (decoded) or a `Uint8Array`, and the typed client sends
    the call's `body` on the wire unchanged under a raw content type you can
    override per call via `headers` — a `text/csv` or binary upload that stays
    inside the typed contract and client. Both engines and the OpenAPI document
    understand it; the 415 check is lenient (`text/*` for text, any media type for
    bytes) so the schema is the gate.
  - **`mounts` handlers receive `env` and `executionContext`.** Prefix-mounted
    sub-handlers (`toFetchHandler` and the compiled engine) are now called with
    the platform arguments as well as the `Request`, so an env-dependent
    sub-router — Better Auth on Cloudflare Workers, where secrets and the DB URL
    live on `env` — can build its instance inside the mount. Existing
    `(request) => Response` mounts keep working.

  **`@amritk/mini`**

  - **`bindSelect(node, model)`** — two-way binding between a `<select>` and a
    string signal, the dropdown analogue of `bindValue`/`bindChecked`: it sets
    `.value` (the property, so the option actually selects) and writes back on
    `change`.
  - **More typed form-control attributes.** `<input>` gains `name`, `checked`,
    `accept`, `min`, `max`, `step`, `multiple`, and `readonly`; `<textarea>` gains
    `name`, `required`, and `readonly` — so file, number, and checkbox inputs stop
    needing `ref` + `setAttribute`.

## 0.5.0

### Minor Changes

- da1be72: Compiled-engine parity and deployment features: `hashContracts` plus a baked `contractsHash` with an init-time staleness warning in every module `compileToModule` emits (schema edits without regeneration now surface as a `console.error` instead of silent drift); `compileExport` on `CompileModuleOptions` so a custom `ValidatorCompiler` (the runtime `compile` option) drives every guard and collector in the compiled engine too; `validateResponses` on `CompileModuleOptions` for runtime-identical reply body/header validation (`invalid_response` 500s) in the compiled engine; and `fetchToNodeHandler`, a general Node bridge that runs any fetch handler — a compiled module's `fetch` export included — under `node:http`/Express with streaming, repeated `set-cookie`, backpressure, and disconnect handling.
- 5395bed: Add more framework-parity helpers, all composing through existing seams
  (`mounts`, `onRequest`/`onResponse`, the raw response, the context factory) —
  no request-pipeline changes:

  - `createCsrf` — stateless double-submit CSRF protection.
  - `createHealth` — a health/readiness endpoint (`200`/`503`) running probes
    concurrently, for load balancers and Kubernetes gates.
  - `signCookie`/`unsignCookie`/`createSignedCookies` — HMAC-SHA256 signed
    cookies over Web Crypto (no dependency).
  - `sseStream`/`formatSse` — Server-Sent Events as a streaming body for
    raw-`contentType` routes.
  - `negotiateMediaType`/`parseAccept` — server-driven content negotiation with
    RFC 9110 media-range specificity and `q=0` handling.
  - `versionRoutes` — URI-prefix API versioning (`/v1`, `/v2`).
  - `withTimeout` — a per-handler wall-clock deadline.
  - `runAfterResponse`/`createBackground` — after-response ("background") work
    via `waitUntil` where the platform provides it.

- 09ff86c: Add framework-parity middleware helpers, each composing through the existing
  `onRequest`/`onResponse`/`mounts` seams (no core pipeline changes):

  - `createRateLimit` — request rate limiting with `RateLimit-*`/`Retry-After`
    headers, a 429 short-circuit, and a pluggable store (in-memory default).
  - `createRequestId` — correlation-id propagation into `locals` and the
    response, with `getRequestId`.
  - `createSecurityHeaders` — the `helmet`/`secure-headers` baseline as an
    `onResponse` decorator.
  - `createCompression` — gzip/deflate response compression over the platform
    `CompressionStream`.
  - `createETag` — automatic entity tags and conditional-GET (`304`) handling.
  - `createDocs` — an interactive API reference page (Scalar/Swagger UI/ReDoc)
    served next to `openapi.json`, with `docsHtml`.

- da1be72: Deep-review hardening pass across the client, OpenAPI projection, request pipeline, and bundler plugins.

  **Breaking (pre-1.0 minor): request bodies are now capped at 1 MiB by default.** `maxBodyBytes` keeps its meaning on both adapters and `compileToModule`; unset now means 1 MiB instead of unbounded (a memory-exhaustion vector), and `maxBodyBytes: Infinity` restores unbounded reads.

  **Typed client.** `fetchOptions` (client-level and per-call `RequestInit` extras — `credentials`, `cache`, `redirect`, …) and `timeoutMs` (composes with a per-call `signal` via `AbortSignal.any`). Requests send `accept: application/json` by default. A declared JSON status whose body fails to parse throws `malformedBodyError` — recognizable via `isMalformedBodyError`, carrying the `Response` and the parse error as `cause` — instead of a bare `SyntaxError`. Documented: the `cookies` slot cannot work from browsers (forbidden header); use server-set cookies plus `fetchOptions: { credentials: 'include' }`.

  **OpenAPI.** Greedy `{name+}` routes now emit valid documents (`{name}` templates with a matching, described parameter). Schemas carrying internal `$ref`s hoist into `components.schemas` with refs re-rooted, so recursive shapes resolve. Every operation gets a deterministic `operationId` (explicit wins; duplicates throw at startup). `info` accepts `contact`/`license`/`termsOfService`, documents accept top-level `tags` objects (plumbed through `createApi` and `compileToModule`), and multipart file parts get `encoding` entries. The served document carries a strong `etag` + `cache-control: no-cache`, answers `304` to `if-none-match`, and is serialized once per process.

  **HTTP semantics (both engines, differential-pinned).** `OPTIONS` on a known path answers `204` with a sorted `allow` header (explicit `options` routes still win), and 405 `allow` lists advertise `OPTIONS`. `refine` may be async — a returned promise is awaited, rejections take the `onError` path.

  **Node adapter.** Streaming replies honor `write()` backpressure with a hang-proof `drain` wait, so fast producers no longer buffer unbounded memory against slow clients.

  **CORS.** `createCors` throws at setup on the browser-rejected `origin: '*'` + `credentials: true` combination.

  **Bundler.** New `stripContractsEsbuild` and `stripContractsRollup` join the Vite and Bun plugins, and the strip transform is now line-preserving so `map: null` no longer misaligns downstream sourcemaps.

  The cap keeps the native read path: a body whose declared `content-length` fits the limit reads via `arrayBuffer()` (with a post-read length check), and only chunked or unparseable-length requests take the streaming capped reader — so on realistic traffic the default cap costs ~4%, not the 82% an always-streaming read would.

- ca672c3: Add `streamMultipart` (and `multipartBoundary`) — a streaming
  `multipart/form-data` parser for large file uploads. Where the pipeline's
  built-in multipart handling buffers the whole body via `Response.formData`,
  this yields each part with its bytes streamed, so a multi-gigabyte upload flows
  through at constant memory. Reach it from a handler through `request.raw`.
  Purely additive — the existing buffered path is unchanged.

### Patch Changes

- 824b869: Map the host framework's body-limit error to a 413. When the API is mounted on
  another server (Fastify's content-type parser at its `bodyLimit`, Express's
  `body-parser`/`raw-body`, or any HTTP error carrying a 413 status), an
  oversized body now takes the `payloadTooLarge` path instead of the generic
  `onError`/500 — fixing e.g. a 20 MiB body returning `500` rather than `413`.
  Recognition is shared by the interpreted and compiled engines.

## 0.4.0

### Minor Changes

- aabd4c4: Slim browser bundles for `createClient` — a contract-slimming bundler plugin plus opt-in wire formats.

  **New: `@amritk/api/bundler`.** `stripContractsVite()` (Vite) and `stripContractsBun()` (`Bun.build`) strip server/OpenAPI freight — request/response schemas, `refine`, `summary`, `description`, tags, security — from `defineContract` call sites in browser builds, keeping only what the client runtime reads (`method`, `path`, `bodyType`, body/`contentType` markers). Types are compile-time, so consumers see no difference; unparseable call sites are left untouched. Measured on a three-contract JSON-only widget: contract data drops from 1.3 kB to 0.31 kB minified (~75% per route), the full bundle from 3.6 kB to 2.7 kB minified (1.7 kB to 1.4 kB gzip).

  **Breaking: form/multipart serialization is now opt-in.** `bodyType: 'form'` / `'multipart'` contracts need their serializer registered: `createClient(contracts, url, { serializers: [formBodySerializer, multipartBodySerializer] })`. JSON stays built in (and can be overridden with a custom `bodyType: 'json'` serializer). Calling a contract whose `bodyType` has no registered serializer throws with the fix in the message.

  **Breaking: `{param}` path building is now opt-in.** Contracts with path parameters need `createClient(contracts, url, { pathParams: buildParamPath })`. Static-path apps pass nothing and no longer bundle the template code.

### Patch Changes

- 6e7c65e: Slim published packages — comments are now stripped from the compiled JS in `dist` (they were duplicating the JSDoc that already ships in the `.d.ts` files, which is what editors read), and `@amritk/lint` now minifies its bundled OpenAPI meta-schema JSON documents. Unpacked size drops ~30% across the board (for example `@amritk/lint` 448 kB → 307 kB, `@amritk/generate-parsers` 293 kB → 191 kB) with no behavior change: declaration files keep their docs, `/* @__PURE__ */` annotations and the CLI shebang survive, and `@amritk/helpers` still ships its TypeScript sources for embedded mode.
- Updated dependencies [6e7c65e]
  - @amritk/runtime-validators@0.7.3

## 0.3.0

### Minor Changes

- 1c49328: Add a family of `…Of` type helpers so apps can name their wire types straight from contracts instead of casting inline or hand-writing mirrors that drift: `ResponseBodyOf` (one declared status's schema-typed body — `type DemoLimitBody = ResponseBodyOf<typeof demoChat, 402>`), `SuccessBodyOf` / `ErrorBodyOf` (the generated-SDK-style data and error unions, split 2xx vs 4xx/5xx), `ResponseStatusOf` / `SuccessStatusOf` / `ErrorStatusOf` (the declared status domains), `RequestParamsOf` / `RequestQueryOf` / `RequestBodyOf` / `RequestHeadersOf` / `RequestCookiesOf` (the request slots, `undefined` when undeclared, mirroring what handlers see), and `ClientReplyOf` / `RouteReplyOf` (the client and handler reply unions keyed by the contract, like `ClientInput`). `ResponseBodyOf` derives from the declared schema, so a raw `contentType` status that documents a `body` schema still yields that type for callers who parse the stream themselves.
- e3f493f: Six capabilities driven by porting a production Cloudflare Worker (streaming AI chat, per-tenant auth, KV-backed rate limiting) from Hono — each implemented in both the runtime and compiled engines, held identical by the differential corpus, and eval-free for Workers:

  - **Contract/handler split + derived typed client**: `defineContract` declares a route contract as pure data (browser-safe import, no server code), `implementRoute(contract, handler)` binds the server implementation (`routeImplementer<AppContext>()` for context-typed handlers), and the one-shot `defineRoute` keeps working — every route _is_ a contract. `createClient(contracts, baseUrl, { fetch?, headers? })` derives a typed fetch client from the same contract literals with **no codegen** — the framework-agnostic replacement for Hono's `hc`: per-route calls with schema-typed `params`/`query`/`body`/`headers`/`cookies`, per-call `AbortSignal` and extra headers, injectable `fetch` for tests, and client-level static or (async) function headers for auth tokens. JSON statuses resolve to a `{ status, body, response }` union discriminated on `status`; `contentType` (raw/streaming) statuses expose the untouched `Response` for stream and header access; undeclared statuses throw a recognizable error (`isUnexpectedStatusError`) carrying the unread `Response`.
  - **Platform request escape hatch**: `ApiRequest.raw` carries each adapter's native request — the Web `Request` on the fetch adapter and compiled engine (Workers `request.cf` geo/ASN data), the `IncomingMessage` on Node. Typed `unknown` because reading it is platform-specific by design.
  - **Per-request `locals` bag**: one shared `Record<string, unknown>` per request flows through `onRequest` gates (fourth argument), `onResponse` decorators (third), the context factory (`input.locals`), handlers (`request.locals`), and error formatters/`onError` — an auth gate resolves a tenant once and everyone downstream reads it; a rate-limit gate's counters get stamped onto the response. Created lazily when no hooks are configured, so the untouched path stays allocation-free.
  - **Multiple `set-cookie` headers**: reply headers accept `string | string[]` per name (`ApiResponse`, handler replies, error formatters). Arrays serialize as separate header lines in both adapters and compiled modules via the shared `buildResponseHeaders` helper — never comma-folded, per RFC 6265 — unblocking better-auth session + CSRF and Stripe flows. The Node adapter validates each element before `writeHead`.
  - **Post-validation refinement**: an optional per-route `refine(validated)` hook for cross-field constraints JSON Schema cannot express ("sum of all message lengths ≤ 64k"). Runs after every slot validated, before the context factory and handler; returned issues reject through the standard `validation_failed` envelope (and `validationFailed` formatter) with custom `path`/`message`; a thrown refine takes the `onError` path.
  - **Unmatched-request observability**: `observeUnmatched` (compiled: `observeUnmatchedExport`) is called once per 404/405 with `route: undefined` — request-logging parity with framework middleware without wrapping the adapter. Kept separate from `observe` so its `route` stays non-optional.

  Breaking (pre-1.0 minor): `FetchOnRequest`/`FetchOnResponse` gained the trailing `locals` parameter and their `env`/`executionContext` parameters are now typed `unknown` instead of optional — hook _implementations_ are unaffected; only code invoking hook values directly must pass the extra arguments.

## 0.2.0

### Minor Changes

- 7c8fa86: Seven new capabilities, each implemented in both the runtime and compiled engines and held identical by the differential corpus:

  - **Form and multipart bodies**: `request.bodyType: 'form' | 'multipart'` parses `application/x-www-form-urlencoded` (query-style coercion: typed keys coerce, array keys accumulate) and `multipart/form-data` (string parts coerce, file parts reach the handler as `File` objects — declare them without a `type` keyword) against the declared body schema. Multipart parsing rides the platform's `Response#formData` over the shared buffered read, so `maxBodyBytes` still caps uploads. Parse failures answer `400 { error: 'invalid_body' }` (new `errors.invalidBody` formatter).
  - **415 enforcement**: a request whose `content-type` contradicts the declared body type answers `415 { error: 'unsupported_media_type' }` (new `errors.unsupportedMediaType` formatter) before any read. An absent content-type still falls through to the parse, so bare `curl` keeps working; JSON accepts `+json` structured suffixes.
  - **Greedy catch-all path parameters**: `/files/{path+}` (the AWS API Gateway convention) captures one or more remaining segments, decoded per segment and joined with `/`. Must be last; the bare prefix stays 404.
  - **OpenAPI components**: schemas carrying a `title` and reused across body positions hoist into `components.schemas` with `$ref` references — one `User` component and one generated client type instead of N inline copies. Conflicting titles stay inline.
  - **OpenAPI security, servers, deprecated**: `createApi`/`compileToModule` accept `servers`, `securitySchemes`, and a document-level default `security`; routes accept per-operation `security` and `deprecated`.
  - **Response header documentation**: `responses[status].headers` declares header schemas — emitted as OpenAPI header objects and validated (as an open object) under `validateResponses`, failing to the `invalid_response` 500 with `source: 'headers'`.
  - **`observe` hook**: called once per matched request with `{ route, request, status, durationMs, env, executionContext }` — per-route latency metrics and structured request logs with the route _pattern_ as the grouping key. Validation failures and handler errors are observed; 404s/405s and the OpenAPI document are not; a throwing observer is swallowed; unset costs nothing. Compiled via `observeExport`.

- 4e23c02: Production-readiness pass over both engines and both adapters:

  - **HEAD support (RFC 9110)**: `HEAD` is served automatically wherever `GET` is — the GET pipeline runs (validation, handler, response headers) and the adapters discard the body, cancelling streams rather than leaking them. Explicit `head` routes override the fallback. `405` allow lists advertise `HEAD` whenever `GET` appears, `matches()` claims HEAD for Express-style fallthrough, and the OpenAPI path answers HEAD too. Implemented identically in the runtime and compiled engines (held by the differential corpus).
  - **Shared buffered body reads**: `readBody`/`readText`/`readBytes` now share one buffered read in both adapters and in compiled modules, so handlers can read the body repeatedly and alongside a declared body schema (webhook HMAC plus parsed access). Previously a second read hung forever on Node and threw on fetch runtimes.
  - **Adapter failure boundary**: a reply that cannot be serialized (circular body, invalid header name/value) now answers the pipeline's own `500 { error: 'internal_error' }` instead of escaping as an unhandled rejection — in `toFetchHandler`, `toNodeHandler` (which pre-validates handler headers, since a mid-write `writeHead` failure leaves Node's response unrecoverable), and compiled modules.
  - **Query hardening**: query objects are built with a null prototype, so keys like `__proto__` land as ordinary own properties for the schema to judge instead of being silently dropped by the prototype setter.
  - **Node adapter**: JSON replies carry `content-length` instead of chunked transfer encoding.
  - **Packaging**: `sideEffects: false` and `engines.node >= 20` declared; README documents the requirements, the pre-1.0 stability policy, and the fetch/Node adapter feature split.

### Patch Changes

- Updated dependencies [4e23c02]
  - @amritk/runtime-validators@0.7.2

## 0.1.0

### Minor Changes

- 4015b4d: Ship the adoption-readiness feature set, in both the runtime and compiled engines:

  - **Raw request bodies**: `ApiRequest.readText` / `readBytes` for webhook HMAC verification and uploads; the pipeline only consumes the body stream when a body schema is declared.
  - **Body size cap**: `maxBodyBytes` on `toFetchHandler` / `toNodeHandler` / `compileToModule` answers 413 via a shared capped stream reader (`readBytesCapped`), enforced for pipeline and handler-initiated reads alike.
  - **Streaming replies**: response contracts may declare `contentType`; handlers then return `ReadableStream` / `Uint8Array` / string bodies that adapters send untouched. `ApiRequest.signal` aborts on client disconnect.
  - **Hook chains**: `toFetchHandler({ onRequest, onResponse })` — short-circuiting gates before mounts/routing and decorators on every outgoing response; compiled via `onRequestExports` / `onResponseExports`.
  - **CORS**: `createCors(options)` returns an onRequest/onResponse hook pair handling preflight and response decoration.
  - **Custom error envelopes**: `createApi({ errors })` formatters for notFound / invalidJson / payloadTooLarge / validationFailed; compiled via `errorsExport`.
  - **Header schemas**: `request.headers` validates declared headers (with coercion) and emits `in: 'header'` OpenAPI parameters.
  - **Typed client**: the OpenAPI output is covered by a Hey API (`@hey-api/openapi-ts`) integration test generating a typed fetch SDK.
  - **Error reporting**: `onError` receives `(error, request, { route, env, executionContext })` in both engines (`onErrorExport` compiled), and `createSentry({ capture })` packages it for any Sentry-compatible client with zero added dependencies.
  - **Query fast path**: plain query strings parse in one pass without `URLSearchParams` (`buildQueryObjectFromString`, `ApiRequest.queryString`), with an exact fallback for encoded input — ~46% more throughput on query-validated routes.
  - **Docs**: the package README now covers the full surface with Drizzle / Better Auth / Sentry / Hey API integration recipes.
  - **405 Method Not Allowed**: a known path under the wrong method answers 405 with a sorted `allow` header instead of 404, in both engines; reshape it with `errors.methodNotAllowed`.
  - **Cookie schemas**: `request.cookies` validates declared cookies (RFC 6265 unquoting, percent-decoding, coercion, `source: 'cookies'` failures) and emits `in: 'cookie'` OpenAPI parameters.

- 4601f84: New package: contract-first, framework-agnostic API layer. Declare routes once (method, path, JSON Schemas, handler) and get typed handlers via `FromSchema`, guard-first request/response validation through `@amritk/runtime-validators` (pluggable for generated validators), OpenAPI 3.1 generation and serving with no extra code, and adapters for fetch-based frameworks (Hono, Next.js, Bun, Workers, Deno) and Node (Express, Fastify, node:http). Includes `compileToModule`, a build-time compiler that emits a fused, eval-free fetch-handler module from the same contracts — inlined guards, schema-derived serializers, precomputed OpenAPI — held observationally identical to the runtime engine by a differential test and measured faster than Hono on Cloudflare-Workers-style V8 workloads.

### Patch Changes

- Updated dependencies [797a156]
  - @amritk/runtime-validators@0.7.1
