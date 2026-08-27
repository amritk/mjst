# Architecture

## Overview

`mjst` is a **Bun monorepo** that generates TypeScript type definitions, runtime parsers, and predicate validators from JSON Schema (Draft 2020-12), and lints JSON/YAML documents against JSON Schema and custom style rules. Generated CLI output runs under Node ≥ 20; the development toolchain (install, build, test) uses Bun.

## Monorepo Structure

```
mjst/
├── packages/
│   ├── cli/                   # @amritk/mjst — command-line interface (generate + lint)
│   ├── api/                   # @amritk/api — contract-first HTTP API layer (routes, validation, OpenAPI, typed client)
│   ├── lint/                  # @amritk/lint — format-agnostic JSON/YAML style-guide linter
│   ├── generate-parsers/      # @amritk/generate-parsers — parser + type generator
│   ├── generate-validators/   # @amritk/generate-validators — predicate validator generator
│   ├── runtime-validators/    # @amritk/runtime-validators — eval-free runtime schema interpreter
│   ├── generate-examples/     # @amritk/generate-examples — fast-check arbitrary + example generator
│   ├── generate-markdown/     # @amritk/generate-markdown — schema → markdown docs (README table + prose reference)
│   ├── adapters/              # @amritk/adapters — convert external schemas (TypeBox, …) to JSON Schema
│   ├── resolve-refs/          # @amritk/resolve-refs — inline internal/cross-file/remote $refs
│   ├── yaml/                  # @amritk/yaml — tiny YAML parser with exact source positions
│   └── helpers/               # @amritk/helpers — shared schema utilities + runtime
├── .claude/                   # Developer guidelines
├── .changeset/                # Changesets config (release automation)
├── .github/                   # CI, release, issue & PR templates
└── package.json               # Workspace root (private)
```

## Packages

### `@amritk/mjst` (`packages/cli`)

Command-line entry point. Reads CLI flags and/or a JSON config file, loads a schema, runs the generator, and writes TypeScript output. It also carries a `lint` subcommand (`mjst lint <files>`) that lints JSON/YAML documents via `@amritk/lint` and prints a compact `file:line:col` report.

- **Depends on:** `@amritk/generate-parsers`, `@amritk/lint` (`@amritk/generate-markdown` is a **dev** dependency — only `scripts/generate-readme.ts` uses it, and that script is not published)
- **Bin:** `mjst` → `dist/cli.js` (built for the Node target)
- **Config schema:** `config.schema.json` — also drives the CLI README table via `@amritk/generate-markdown`. The `lint` subcommand has its own independent flags (see the CLI README).

### `@amritk/api` (`packages/api`)

Contract-first, framework-agnostic HTTP API layer. Each route declares its method, path, request schemas, and response schemas once; from that one contract the package derives typed handlers (`FromSchema`), runtime request/response validation, an OpenAPI 3.1 document (contract schemas embed verbatim — 3.1's dialect *is* Draft 2020-12), and a typed fetch client (`createClient`, no codegen). Two engines execute the same contracts: the **runtime engine** (`createApi` — eval-free, powered by `@amritk/runtime-validators`, for development and CSP-restricted platforms) and the **compiled engine** (`compileToModule` — emits a fused fetch-handler module with inlined guards, schema-derived serializers, and a precomputed OpenAPI string, for production/Cloudflare Workers). A differential test corpus holds the two engines observationally identical. Adapters: `toFetchHandler` (Bun, Workers, Deno, Hono, Next.js) and `toNodeHandler` (node:http, Express/Connect). `@amritk/api/client` is the browser-safe entry — the client surface (`createClient`, `defineContract`, the opt-in serializers, error predicates, type helpers, client-side auth helpers) with an import graph that touches no server module or `node:*` built-in (pinned by a test), so frontends bundle it without externalization warnings; the client's non-JSON pieces (`pathParams: buildParamPath`, `queryParams: toSearchParams`, `cookies: appendCookies`, form/multipart serializers) are registered opt-ins, so a JSON-only static-path app bundles none of them. `@amritk/api/bundler` ships contract-slimming build plugins for browser bundles, and `@amritk/api/dev` ships hot reloading for the development server (`createHotApi` — a stable `Api` whose build is swapped atomically, keeping the socket and process state; `watchPaths` — the debounced filesystem seam; `importFresh` — the module re-import, whole-graph on Node 22.15+ via a `node:module` resolve hook). Bundler and dev are one-way entries: they may import the runtime, never the reverse, so `node:fs` never reaches the graph that ships to Workers and browsers.

- **Depends on:** `@amritk/runtime-validators` (its single runtime dependency, by design — integrations connect through seams: `context`, `mounts`, hooks, `onError`).
- **Design docs:** `docs/api-framework-plan.md` (architecture + roadmap).

### `@amritk/lint` (`packages/lint`)

A fast, **format-agnostic** JSON/YAML style-guide linter — the library behind the `mjst lint` subcommand. A ruleset maps nodes selected by a **JSONPath** (`given`) to a **function** (`then`): structural validation against a **JSON Schema**, built-in style checks (`casing`, `pattern`, `alphabetical`, `length`, …), or a custom function. Every finding carries an exact `line:column` range because the parser keeps source positions on every node. The **core engine** ships no built-in ruleset and knows nothing about OpenAPI, AsyncAPI or any other schema — you bring the rules. Two ready-made presets live in subpaths layered on top of it, and never in the root entry.

- **OpenAPI ruleset (`@amritk/lint/rules/openapi`):** a self-contained subpath export layering an OpenAPI preset *on top of* the format-agnostic engine — the `oas` ruleset, the OpenAPI-specific functions (`oasFunctions`), format detectors (`oasFormats`), and auto-fixers (`oasFixers`), plus `createOpenApiRuleset(definition?, basePath?)` which builds a runnable `Ruleset` with those functions/formats layered in and `extends` resolution that understands the `oas` / `loupe:oas` / `spectral:oas` names. It adds no dependencies (the OpenAPI functions/fixers use only the engine's own `core`/`fix` plus `@amritk/runtime-validators`). `$ref` resolution stays the caller's job: pass the built ruleset to the core `lintWithResult` with a resolver (e.g. wrapping `@amritk/resolve-refs`) for rules that need the dereferenced tree.
- **AsyncAPI ruleset (`@amritk/lint/rules/asyncapi`):** the same shape for event-driven APIs — 56 rules covering AsyncAPI **2.0–2.6 and 3.0**, with `createAsyncApiRuleset(definition?, basePath?, options?)`, the `asyncapi` ruleset definition, `aasFunctions`, `aasFormats` (`aas2`, `aas2.0`–`aas2.6`, `aas3`, `aas3.0`), and `extends` resolution for the `asyncapi` / `loupe:asyncapi` / `spectral:asyncapi` names. No auto-fixers yet. Adds no dependencies. Three things an editor needs to know:
  - **The vendored meta-schemas carry three deliberate regex rewrites.** The official schemas contain patterns that nest unbounded quantifiers — one genuinely exponential — which `@amritk/runtime-validators` refused to compile when the schemas were vendored. Each is replaced by a provably equivalent pattern, proven over a generated corpus in `schemas/schema.test.ts`. Re-vendoring without re-applying them fails that test. Never reach for `allowUnsafePatterns` instead. The screen has since been relaxed to admit *separator-anchored* repetitions, naming two of these three as its motivating cases, so only the exponential one is still refused; `schema.test.ts` pins the current verdict for each in both directions, and the other two rewrites are kept as equivalent simplifications rather than necessities. See `src/rules/asyncapi/schemas/README.md`.
  - **Which tree a rule sees is a per-rule decision, pinned by `ruleset-manifest.test.ts`.** A rule reading what the author wrote (addresses, server variables, tag names, reference targets) runs `resolved: false`, so a reusable definition is read at its declaration and nowhere else. A rule validating schema *content* (payloads, headers, examples) must see the dereferenced tree, or a `$ref`'d schema is an opaque `{$ref: …}`. A resolved rule matches a reusable definition once per `$ref` reaching it — shared with the OpenAPI preset and with Spectral — but every match is reported at the declaration, so the copies are identical and `withoutDuplicates` (in `core/order.ts`) keeps only the first.
  - **A schema taken from the document is not a schema written in the ruleset.** It can carry a `$ref` this package cannot follow (an external file, or anything at all with no resolver injected), so the rules that validate one pass `skipUnusableSchema: true` to the built-in `schema` function and stay silent where they cannot judge. Reporting instead put the validator's own API advice on a valid document at error severity.
- **Shared rule functions (`src/rules/shared/`):** what both presets genuinely have in common — the Server Object `variables` check and tag-name uniqueness. Neither preset imports from the other; both wrap these. `serverVariables` takes the address fields to read as an option (`url` by default, `host`/`pathname` for AsyncAPI 3.0), because OpenAPI runs it under a recursive `$..links[*].server` given where reading 3.0's fields would flag example payloads.
- **Depends on:** `@amritk/runtime-validators` (the built-in `schema` function — and the OpenAPI and AsyncAPI example/payload/schema rules — run an arbitrary JSON Schema over a matched node) and `@amritk/yaml` (source-position-preserving YAML parsing so findings map back to `line:column`).
- **Entry points:** `lintDocument(input, options?)` → `IDiagnostic[]`; `lintDocumentWithResult` (adds a plugin's rewritten `output`); `fixDocument` (applies a `FixerRegistry` to a fixpoint, then re-lints); `createRuleset` / `resolveNamedRuleset` (normalize a definition, layer built-in functions, resolve `extends`).
- **Rendering is the caller's job:** `lintDocument` returns structured findings only — the library ships no output "formatter" layer, and the CLI supplies its own `file:line:col` report.

### `@amritk/generate-parsers` (`packages/generate-parsers`)

Core code generator. Given a `JSONSchema` and a root type name, produces an array of `GeneratedFile` objects — TypeScript type definitions plus optional runtime parser functions that validate and coerce unknown input.

- **Depends on:** `@amritk/helpers`, `json-schema-typed` (`@amritk/generate-markdown` is a **dev** dependency — only `scripts/generate-readme.ts` uses it, and that script is not published)
- **Subpath imports:**
  - `#generators/*` → `./src/generators/*.ts`
  - `#helpers/*` → `./src/helpers/*.ts`
  - `#types/*` → `./src/types/*.ts`
- **Key entry point:** `src/generators/build-schema.ts` — traverses the root schema and its `$ref` / `$dynamicRef` graph recursively.

### `@amritk/generate-validators` (`packages/generate-validators`)

Generates lightweight predicate-style validators: each schema becomes a `validateFoo(input, _path?): ValidationResult` function. No coercion, just shape checks plus structured error paths.

- **Depends on:** `@amritk/helpers`, `json-schema-typed`
- **Subpath imports:** `#generators/*` → `./src/generators/*.ts`
- **Key entry point:** `src/generators/build-schema.ts`

### `@amritk/runtime-validators` (`packages/runtime-validators`)

The runtime counterpart to `generate-validators`. Instead of writing validator source files at build time, it validates a JSON Schema discovered **at runtime** (a plugin config, a user-supplied schema). It is an **eval-free interpreter** — it walks the schema directly, with no `new Function` and no compile step — so it has zero startup cost and runs anywhere `eval` is forbidden (strict CSP, Cloudflare Workers, React Native/Hermes). The trade-off vs Ajv is deliberate: it wins the cold one-shot path (validate a few values per schema) by ~96–870×, and loses steady-state throughput (one schema, many values) by ~6–11× — use the build-time `generate-validators` for that.

- **Depends on:** `json-schema-typed` (types only). Deliberately self-contained — no `@amritk/helpers` — so the runtime stays slim. `ajv` / `ajv-formats` are dev-only, for the benchmark suite and the differential fuzz test.
- **Consumed by:** `@amritk/lint` — its built-in `schema` rule function validates a matched node against an arbitrary runtime-supplied JSON Schema through this interpreter.
- **Entry points:** `validate(schema)` → error-collecting validator (`true | { valid: false, errors }`); `validateGuard(schema)` → zero-allocation boolean type guard. Both go through `src/interpreter/prepare.ts` (a `WeakMap` cache over the interpreter).
- **Design notes:** a single recursive walker (`src/interpreter/interpret.ts`) evaluates the schema against the value; the error array is allocated lazily so valid input never allocates, and the guard path short-circuits on first failure. The only reusable work — compiling `pattern` regexes and resolving local `$ref`s (JSON-Pointer fragments and `$anchor` names) — is memoized per validator. Recursion via `$ref` terminates naturally as the data shrinks. Parity with Ajv is enforced by `src/differential.test.ts` (~144k random/mutated values). OpenAPI `nullable: true` is honored (null accepted regardless of type).

### `@amritk/generate-examples` (`packages/generate-examples`)

Generates **test data** from a schema. For each schema node it emits a type definition, a [`fast-check`](https://github.com/dubzzz/fast-check) arbitrary (`FooArbitrary`) for property-based testing, and a concrete, self-contained example value (`fooExample`) for fixtures/seeds/docs.

- **Depends on:** `@amritk/helpers`, `json-schema-typed`. `fast-check` is an **optional peer dependency** — only the *generated* arbitraries import it; the generator itself and the static `fooExample` values do not.
- **Subpath imports:** `#generators/*` → `./src/generators/*.ts`
- **Key entry points:** `src/generators/build-schema.ts` (pipeline), `generate-arbitrary.ts` (fast-check combinator emitter), `derive-example.ts` (concrete value derivation + serialization). Tests assert the generated source strings rather than executing fast-check, keeping them hermetic.

### `@amritk/generate-markdown` (`packages/generate-markdown`)

Renders a `config.schema.json` as documentation, in two shapes:

- **The README table** (`generateMarkdown`) — one HTML `<table>` of the config reference, spliced into a `README.md` between marker comments. Used to keep the CLI / generator READMEs in sync with their config schemas. Reads the `x-cli-flag` and `x-icon` extension keywords.
- **A prose reference** (`generateMarkdownFiles` → `GeneratedFile[]`, `generateDocs` for the filesystem) — a heading, a **Type:**, the description and a code example per property, split across as many markdown files as the schema asks for. Driven by one `x-doc` vendor extension: `pages` and `sections` place a property, `example`/`note`/`footer` carry the prose a JSON Schema keyword has nowhere to put, `type` overrides a label JSON Schema cannot spell (`(heading: Heading) => string`), and `layout` picks headings, a table, or nothing for a property's children. Examples are derived from a property's `examples` and wrapped back into the shape of the config file when the schema does not supply one. Golden output for two realistic schemas lives in `packages/generate-markdown/fixtures/expected/` and is regenerated with `bun run generate-fixtures`.

### `@amritk/adapters` (`packages/adapters`)

Converts schemas authored in external libraries into Draft 2020-12 JSON Schema so the rest of the pipeline can consume them unchanged. Each adapter is a pure `(source: unknown) => JSONSchema` function; loading the source module is the CLI's job (`--input <format>` / `--export <name>`).

- **Implemented:** `typebox`, `zod`, `valibot`, `effect`, and `avro`. Each external library is an optional peer dependency loaded at runtime (so the core stays slim): TypeBox schemas are already JSON-Schema-shaped (strip symbol keys + rewrite extended types); `zod` uses Zod 4's `toJSONSchema`; `valibot` uses `@valibot/to-json-schema`; `effect` uses `JSONSchema.make`. The Zod, Valibot, and TypeBox adapters map their date types to the `x-mjst` Date extension; the Effect adapter passes through Effect's encoded (string) representation. `avro` is the odd one out twice over: an `.avsc` is JSON rather than a module, so the CLI reads and parses it instead of `import()`ing it (and `--export` does not apply), and Avro has no JSON Schema exporter to delegate to, so the conversion is implemented in full here — with no dependency, since the input is already JSON. It takes an `encoding` option because Avro's *own* JSON encoding and the idiomatic decoded object genuinely differ: `'json'` (the default, and what the CLI uses) gives nullable unions, base64 bytes and optional defaulted fields, while `'avro-json'` gives the spec's branch-tagged union wrappers, latin-1 byte strings and every field required — Avro has no optional fields, so a `default` only matters when reading data written against a different schema. That second mode exists so an AsyncAPI `examples.payload` declared `application/vnd.apache.avro+json` can be validated against the schema it claims to follow, which the AsyncAPI ruleset stands down on today.
- **Lossy constructs:** types JSON Schema cannot express are preserved as an `x-mjst` vendor extension rather than dropped. `@amritk/helpers/mjst-extension` defines the shared contract (`MJST_EXTENSION_KEY`, `MjstExtension`, and the readers `getMjstInstanceOf` / `getMjstPrimitive` / `getMjstBrand`), which the type generator, parsers, and validators read to emit the right TypeScript type and runtime checks. The extension currently carries: `instanceOf` (a runtime class such as `Date`, checked with `instanceof`), `primitive` (a non-JSON primitive such as `bigint`, checked with `typeof`), and `brand` (a type-level nominal brand — the value still validates as its base JSON type at runtime, but the generated TypeScript type is intersected with a unique brand). Brands cannot be auto-detected from the source libraries (Zod/Valibot/Effect brands are type-level or stripped during conversion), so they are opt-in via a hand-authored `x-mjst.brand` keyword — which TypeBox passes through from `Type.String({ 'x-mjst': { brand: 'UserId' } })`.

### `@amritk/resolve-refs` (`packages/resolve-refs`)

Resolves and inlines `$ref`s into a single dereferenced document — internal (`#/...`) pointers, cross-file refs, and remote http(s) documents. A one-pass, cycle-safe resolver: each unique ref resolves once, and a self-reference is *kept* as a `$ref` that resolves within the output document rather than looping or collapsing the recursive branch. Fetched remote documents are cached in memory for the session — keyed by URL **and** by the credentials/transport they were fetched with, so one tenant's document can never be served to a call carrying different credentials — bounded by size and TTL, with concurrent loads of the same URL (and same credentials) coalesced onto one request; local files are re-read each pass (they may change on disk in a long-lived session). Remote fetches are guarded by a **default-deny SSRF check**: `isPrivateHost` refuses loopback, private, link-local, IPv4-mapped IPv6, and cloud-metadata hosts by IP (`169.254.169.254`) *and* by name (`metadata.google.internal`, anything under `.internal`), and `assertPublicHost` additionally resolves the hostname and refuses it when any address it points at is non-public (closing the `127.0.0.1.nip.io` gap; true DNS-rebinding protection would need connection pinning, which Node's `fetch` does not expose). Redirects are followed manually (`redirect: 'manual'`) with both guards re-applied to every hop, so an allow-listed host cannot bounce to a private address. Local `$ref`s are confined the same way: by default a ref may only resolve **under the root document's directory**, so `{"$ref": "../../etc/passwd"}` is refused (widen it with `allowedRoots`, or turn cross-file reads off entirely with `localRefs: false`). A resolve is also bounded as a whole by `maxDocuments`, `totalTimeoutMs`, and `maxDepth`.

- **Depends on:** nothing. Documents are parsed as JSON only (mjst deals in JSON Schema), and there is no `@amritk/*` dependency, so it stays a slim, standalone resolver.
- **Entry points:** `resolveRefs(data)` — in-memory, internal refs only; `resolveRefsFromFile(filename, options)` — from disk or a URL, including cross-file and remote refs. Errors are collected on the result (never thrown); a ref whose target was refused, unreadable, or never reached keeps its `$ref` in the output rather than being inlined, so the failure is visible in the document as well as on `errors` — inlining `undefined` dropped every constraint on the referencing node, and inlining `{}` replaced it with a schema that accepts anything. A ref the SSRF or `allowedRoots` guard refused therefore remains in the output verbatim: the guard is this resolver's, so a consumer that feeds the result to a *second*, unguarded resolver reopens the question the guard answered.
- **Relationship to the lint repo:** mirrors the resolver shipped in `@amritk/loupe-ref-resolver` (the Loupe linter). The intent is for this published package to become the single shared implementation both repos depend on.

### `@amritk/yaml` (`packages/yaml`)

A tiny, dependency-free YAML parser built for diagnostics: every node maps back to an exact `line:column` source position. Used to load `.yaml`/`.yml` schema/config documents (e.g. via the `resolveRefsFromFile` `parse` callback) and by `@amritk/lint` to parse linted documents, while preserving the locations needed to point at the offending node in an error.

- **Depends on:** nothing.
- **Scope:** a pragmatic subset of YAML 1.2 sized for configs/OpenAPI — block & flow collections, block scalars (`|`/`>`), quoted/plain scalars, comments, and anchors. Out of scope by design: multi-document streams (only the first document is read), explicit `?` mapping keys, and exotic tags.

### `@amritk/helpers` (`packages/helpers`)

Shared utility belt used both by the generators and copied into generated output. Each helper is exposed as its own subpath export (`@amritk/helpers/<name>`) so consumers — and generated files — only pull in what they need.

The `$ref`-graph traversal that the parser, validator, and example generators run is centralized in `@amritk/helpers/walk-ref-graph`: it upgrades draft-07 input, resolves each ref, rewrites `$dynamicRef` → `$ref`, seeds `$dynamicAnchor`-only definitions, derives type/file names, and memoizes the resolution work per root document. Each generator only turns the prepared node into file content and barrels the result with `@amritk/helpers/generate-index-barrel`.


Categories:

- **Schema traversal:** `extract-refs`, `resolve-ref`, `build-dynamic-ref-map`, `resolve-dynamic-refs`, `extract-dynamic-anchor-defs`, `upgrade-draft07-schema`, `ref-to-filename`, `ref-to-name`, `schema-guards`, `walk-ref-graph`
- **Codegen utilities:** `generate-type-definition`, `generate-index-barrel`, `parse-documentation`, `safe-accessor`
- **Runtime helpers (referenced from generated output):** `is-object`, `validate-array`, `validate-record`, `has-ref`. In `--helpers=embedded` mode (default when `@amritk/helpers` is not resolvable from `outDir`), `@amritk/generate-parsers` reads these sources **at generation time, off disk**: `src/generators/build-schema.ts` locates the installed package with `createRequire(import.meta.url).resolve('@amritk/helpers/package.json')` and reads `src/<helper>.ts` from it (falling back to `dist/<helper>.js`), then emits the content into `outDir/_helpers/` so the generated output is self-contained. Nothing is snapshotted into the generator at build time — which is why `@amritk/helpers`' `files` must keep shipping those four `src/*.ts` files.

## Import Conventions

- **Within a package:** use `#` subpath imports declared in that package's `package.json` (e.g. `import { foo } from '#helpers/foo'`).
- **Cross-package:** use the published package name (e.g. `import { buildSchema } from '@amritk/generate-parsers'`, `import { resolveRef } from '@amritk/helpers/resolve-ref'`).
- **Same directory:** use relative `./` imports.

## Generation Pipeline

```
JSON Schema file
       │
       ▼
  @amritk/mjst (src/cli.ts)
       │  parses CLI args / config, loads schema
       ▼
  buildSchema()                    ← generate-parsers/src/generators/build-schema.ts
       │  traverses $ref graph
       │  resolves $dynamicRef via @amritk/helpers
       │  applies schema extensions
       ▼
  generateFiles()                  ← generate-parsers/src/generators/generate-files.ts
  (per schema node)
       ├─ generateTypeDefinition() ← TypeScript type shape
       ├─ generateParserFunction() ← runtime coercion/validation (skipped with --types-only)
       └─ collectImports()         ← import statements for $ref dependencies
       │
       ▼
  GeneratedFile[]
  { filename, content }
       │
       ▼
  Written to --outDir
  (with --build, tsc compiles them to .js + .d.ts)
```

## Testing

- **Framework:** [Vitest](https://vitest.dev). See `.claude/testing.md`.
- **Convention:** test files colocated with implementation, named `*.test.ts`.
- **Conformance suites:** the packages that implement a spec are measured against
  that spec's official test suite, with an expected-failure list naming every case
  they do not pass and why — `packages/yaml` against the YAML test suite, and
  `runtime-validators` / `generate-parsers` / `generate-validators` /
  `resolve-refs` against the vendored JSON Schema Test Suite
  (`fixtures/json-schema-test-suite`). Each fails when a case moves in *either*
  direction, so a boundary can never move silently.
- **Mocking:** avoided unless necessary (e.g. `generate-markdown` tests stub `node:fs/promises`).
- **Aliases:** `vitest.config.ts` aliases the `@amritk/*` package names back to source so tests run without a build step.

Run all tests:

```sh
bun run test
```

Run tests for a specific package or file:

```sh
bun run test packages/generate-parsers
```

## Design Principles

- **Functional programming:** one function per file, no classes.
- **Type safety:** strict TypeScript throughout (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, etc.) with comprehensive type guards in `@amritk/helpers/schema-guards`.
- **Extensible:** `SchemaExtensions` allows injecting additional optional properties into specific definitions before generation.
- **Node-friendly output:** packages build with `--target=node` so the CLI runs under `npx` / `pnpm dlx` / `bunx` without forcing consumers onto Bun.
