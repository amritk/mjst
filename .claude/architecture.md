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
│   ├── generate-markdown/     # @amritk/generate-markdown — README table generator
│   ├── adapters/              # @amritk/adapters — convert external schemas (TypeBox, …) to JSON Schema
│   ├── resolve-refs/          # @amritk/resolve-refs — inline internal/cross-file/remote $refs
│   ├── yaml/                  # @amritk/yaml — tiny YAML parser with exact source positions
│   ├── helpers/               # @amritk/helpers — shared schema utilities + runtime
│   └── mini/                  # @amritk/mini — tiny signals UI layer (DOM bindings + compilerless JSX)
├── .claude/                   # Developer guidelines
├── .changeset/                # Changesets config (release automation)
├── .github/                   # CI, release, issue & PR templates
└── package.json               # Workspace root (private)
```

## Packages

### `@amritk/mjst` (`packages/cli`)

Command-line entry point. Reads CLI flags and/or a JSON config file, loads a schema, runs the generator, and writes TypeScript output. It also carries a `lint` subcommand (`mjst lint <files>`) that lints JSON/YAML documents via `@amritk/lint` and prints a compact `file:line:col` report.

- **Depends on:** `@amritk/generate-parsers`, `@amritk/generate-markdown`, `@amritk/lint`
- **Bin:** `mjst` → `dist/cli.js` (built for the Node target)
- **Config schema:** `config.schema.json` — also drives the CLI README table via `@amritk/generate-markdown`. The `lint` subcommand has its own independent flags (see the CLI README).

### `@amritk/api` (`packages/api`)

Contract-first, framework-agnostic HTTP API layer. Each route declares its method, path, request schemas, and response schemas once; from that one contract the package derives typed handlers (`FromSchema`), runtime request/response validation, an OpenAPI 3.1 document (contract schemas embed verbatim — 3.1's dialect *is* Draft 2020-12), and a typed fetch client (`createClient`, no codegen). Two engines execute the same contracts: the **runtime engine** (`createApi` — eval-free, powered by `@amritk/runtime-validators`, for development and CSP-restricted platforms) and the **compiled engine** (`compileToModule` — emits a fused fetch-handler module with inlined guards, schema-derived serializers, and a precomputed OpenAPI string, for production/Cloudflare Workers). A differential test corpus holds the two engines observationally identical. Adapters: `toFetchHandler` (Bun, Workers, Deno, Hono, Next.js) and `toNodeHandler` (node:http, Express/Connect). `@amritk/api/bundler` ships contract-slimming build plugins for browser bundles.

- **Depends on:** `@amritk/runtime-validators` (its single runtime dependency, by design — integrations connect through seams: `context`, `mounts`, hooks, `onError`).
- **Design docs:** `docs/api-framework-plan.md` (architecture + roadmap), `docs/ummo-readiness.md` (adoption audit).

### `@amritk/lint` (`packages/lint`)

A fast, **format-agnostic** JSON/YAML style-guide linter — the library behind the `mjst lint` subcommand. A ruleset maps nodes selected by a **JSONPath** (`given`) to a **function** (`then`): structural validation against a **JSON Schema**, built-in style checks (`casing`, `pattern`, `alphabetical`, `length`, …), or a custom function. Every finding carries an exact `line:column` range because the parser keeps source positions on every node. The **core engine** ships no built-in ruleset and knows nothing about OpenAPI or any other schema — you bring the rules.

- **OpenAPI ruleset (`@amritk/lint/rules/openapi`):** a self-contained subpath export layering an OpenAPI preset *on top of* the format-agnostic engine — the `oas` ruleset, the OpenAPI-specific functions (`oasFunctions`), format detectors (`oasFormats`), and auto-fixers (`oasFixers`), plus `createOpenApiRuleset(definition?, basePath?)` which builds a runnable `Ruleset` with those functions/formats layered in and `extends` resolution that understands the `oas` / `loupe:oas` / `spectral:oas` names. It adds no dependencies (the OpenAPI functions/fixers use only the engine's own `core`/`fix` plus `@amritk/runtime-validators`). `$ref` resolution stays the caller's job: pass the built ruleset to the core `lintWithResult` with a resolver (e.g. wrapping `@amritk/resolve-refs`) for rules that need the dereferenced tree.
- **Depends on:** `@amritk/runtime-validators` (the built-in `schema` function — and the OpenAPI example/schema rules — run an arbitrary Draft 2020-12 JSON Schema over a matched node) and `@amritk/yaml` (source-position-preserving YAML parsing so findings map back to `line:column`).
- **Entry points:** `lintDocument(input, options?)` → `IDiagnostic[]`; `lintDocumentWithResult` (adds a plugin's rewritten `output`); `fixDocument` (applies a `FixerRegistry` to a fixpoint, then re-lints); `createRuleset` / `resolveNamedRuleset` (normalize a definition, layer built-in functions, resolve `extends`).
- **Rendering is the caller's job:** `lintDocument` returns structured findings only — the library ships no output "formatter" layer, and the CLI supplies its own `file:line:col` report.

### `@amritk/generate-parsers` (`packages/generate-parsers`)

Core code generator. Given a `JSONSchema` and a root type name, produces an array of `GeneratedFile` objects — TypeScript type definitions plus optional runtime parser functions that validate and coerce unknown input.

- **Depends on:** `@amritk/helpers`, `@amritk/generate-markdown`, `json-schema-typed`
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

The runtime counterpart to `generate-validators`. Instead of writing validator source files at build time, it validates a JSON Schema discovered **at runtime** (a plugin config, a user-supplied schema). It is an **eval-free interpreter** — it walks the schema directly, with no `new Function` and no compile step — so it has zero startup cost and runs anywhere `eval` is forbidden (strict CSP, Cloudflare Workers, React Native/Hermes). The trade-off vs Ajv is deliberate: it wins the cold one-shot path (validate a few values per schema) by ~90–1600×, and loses steady-state throughput (one schema, many values) by ~15–25× — use the build-time `generate-validators` for that.

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

Renders a single configuration-reference table from a `config.schema.json` into a `README.md`. Used to keep the CLI / generator READMEs in sync with their config schemas. Reads `x-cli-flag` and `x-icon` extension keywords.

### `@amritk/adapters` (`packages/adapters`)

Converts schemas authored in external libraries into Draft 2020-12 JSON Schema so the rest of the pipeline can consume them unchanged. Each adapter is a pure `(source: unknown) => JSONSchema` function; loading the source module is the CLI's job (`--input <format>` / `--export <name>`).

- **Implemented:** `typebox`, `zod`, `valibot`, and `effect`. Each external library is an optional peer dependency loaded at runtime (so the core stays slim): TypeBox schemas are already JSON-Schema-shaped (strip symbol keys + rewrite extended types); `zod` uses Zod 4's `toJSONSchema`; `valibot` uses `@valibot/to-json-schema`; `effect` uses `JSONSchema.make`. The Zod, Valibot, and TypeBox adapters map their date types to the `x-mjst` Date extension; the Effect adapter passes through Effect's encoded (string) representation.
- **Lossy constructs:** types JSON Schema cannot express are preserved as an `x-mjst` vendor extension rather than dropped. `@amritk/helpers/mjst-extension` defines the shared contract (`MJST_EXTENSION_KEY`, `MjstExtension`, and the readers `getMjstInstanceOf` / `getMjstPrimitive` / `getMjstBrand`), which the type generator, parsers, and validators read to emit the right TypeScript type and runtime checks. The extension currently carries: `instanceOf` (a runtime class such as `Date`, checked with `instanceof`), `primitive` (a non-JSON primitive such as `bigint`, checked with `typeof`), and `brand` (a type-level nominal brand — the value still validates as its base JSON type at runtime, but the generated TypeScript type is intersected with a unique brand). Brands cannot be auto-detected from the source libraries (Zod/Valibot/Effect brands are type-level or stripped during conversion), so they are opt-in via a hand-authored `x-mjst.brand` keyword — which TypeBox passes through from `Type.String({ 'x-mjst': { brand: 'UserId' } })`.

### `@amritk/resolve-refs` (`packages/resolve-refs`)

Resolves and inlines `$ref`s into a single dereferenced document — internal (`#/...`) pointers, cross-file refs, and remote http(s) documents. A one-pass, cycle-safe resolver: each unique ref resolves once, and a self-reference terminates at `{}` rather than looping. Fetched remote documents are cached in memory for the lifetime of the process (and concurrent loads of the same URL are coalesced onto one request); local files are re-read each pass (they may change on disk in a long-lived session). Remote fetches are guarded by a **default-deny SSRF check** (`isPrivateHost`) — loopback, private, link-local, IPv4-mapped IPv6, and cloud-metadata (`169.254.169.254`) hosts are refused unless explicitly allow-listed. Redirects are followed manually (`redirect: 'manual'`) with the guard re-applied to every hop, so an allow-listed host cannot bounce to a private address.

- **Depends on:** nothing. Documents are parsed as JSON only (mjst deals in JSON Schema), and there is no `@amritk/*` dependency, so it stays a slim, standalone resolver.
- **Entry points:** `resolveRefs(data)` — in-memory, internal refs only; `resolveRefsFromFile(filename, options)` — from disk or a URL, including cross-file and remote refs. Errors are collected on the result (never thrown); a refused or missing target degrades to `{}`.
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
- **Runtime helpers (referenced from generated output):** `is-object`, `validate-array`, `validate-record`, `has-ref`. In `--helpers=embedded` mode (default when `@amritk/helpers` is not resolvable from `outDir`), these sources are snapshotted at `@amritk/generate-parsers` build time and emitted into `outDir/_helpers/` so the generated output is self-contained.

### `@amritk/mini` (`packages/mini`)

A deliberately tiny, compilerless signals UI layer for the bundle-size-sensitive embed widget: `alien-signals` for reactivity, a capped set of DOM bindings that keep data off the `innerHTML` XSS surface (`bindText`/`bindAttr`/`bindClass`/`bindShow`/`bindValue`, plus the single sanctioned `bindHtml` sink), keyed collections (`list`), static-template cloning (`template`), and a compilerless JSX runtime (`@amritk/mini/jsx-runtime`) whose reactivity is decided by value shape — a function-valued attribute or child is a live binding, everything else is applied once. **The cap is the design:** no VDOM, no diffing, no re-render.

- **The `.` entry is byte-budgeted.** Its only runtime dependency is `alien-signals`, and it imports **no** subpath module — that constraint is the whole design, because the widget bundles it. Two tests enforce it: `src/import-boundary.test.ts` walks the `.` source graph (must be `alien-signals` only, and each feature must stay free of the others), and `src/core-size-budget.test.ts` bundles the `.` entry with an esbuild metafile and asserts the gzipped size stays under budget. `"sideEffects": false` keeps everything tree-shakeable.
- **Layered subpath exports** grow it into a framework for the dashboards (not bundle-constrained), each its own module graph so importing one pulls in none of the others: `@amritk/mini/router` (history/hash client router — `createRouter`, `matchRoute`, `<Link>`), `@amritk/mini/flow` (`Show`, `For`, `Switch`/`Match`, `Dynamic`), `@amritk/mini/forms` (field state as signals + validation via a `(values) => errors` function **or** a JSON Schema through `@amritk/runtime-validators`), and `@amritk/mini/query` (a thin `@tanstack/query-core` → signals adapter).
- **Composition is explicit** — no runtime plugin registry / `mini.use()` (it would defeat tree-shaking) and no context/provide-inject; dependencies are prop-drilled (e.g. `<Link navigate={router.navigate}>`). `ref` is the element-extension seam.
- **Depends on:** `alien-signals` (core). `@amritk/runtime-validators` (forms schema validation) and `@tanstack/query-core` (query) are **optional peer dependencies** — install them only for the subpath that needs them.
- **Build:** browser-only (`lib: DOM`, `types: []`), `tsgo -p tsconfig.build.json && tsc-alias && strip-comments`. Tests use Vitest + happy-dom.

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
