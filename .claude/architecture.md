# Architecture

## Overview

`mjst` is a **Bun monorepo** that generates TypeScript type definitions, runtime parsers, and predicate validators from JSON Schema (Draft 2020-12). Generated CLI output runs under Node ≥ 20; the development toolchain (install, build, test) uses Bun.

## Monorepo Structure

```
mjst/
├── packages/
│   ├── cli/                   # @amritk/mjst — command-line interface
│   ├── generate-parsers/      # @amritk/generate-parsers — parser + type generator
│   ├── generate-validators/   # @amritk/generate-validators — predicate validator generator
│   ├── generate-markdown/     # @amritk/generate-markdown — README table generator
│   ├── adapters/              # @amritk/adapters — convert external schemas (TypeBox, …) to JSON Schema
│   └── helpers/               # @amritk/helpers — shared schema utilities + runtime
├── .claude/                   # Developer guidelines
├── .changeset/                # Changesets config (release automation)
├── .github/                   # CI, release, issue & PR templates
└── package.json               # Workspace root (private)
```

## Packages

### `@amritk/mjst` (`packages/cli`)

Command-line entry point. Reads CLI flags and/or a JSON config file, loads a schema, runs the generator, and writes TypeScript output.

- **Depends on:** `@amritk/generate-parsers`, `@amritk/generate-markdown`
- **Bin:** `mjst` → `dist/cli.js` (built for the Node target)
- **Config schema:** `config.schema.json` — also drives the CLI README table via `@amritk/generate-markdown`

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

### `@amritk/generate-markdown` (`packages/generate-markdown`)

Renders a single configuration-reference table from a `config.schema.json` into a `README.md`. Used to keep the CLI / generator READMEs in sync with their config schemas. Reads `x-cli-flag` and `x-icon` extension keywords.

### `@amritk/adapters` (`packages/adapters`)

Converts schemas authored in external libraries into Draft 2020-12 JSON Schema so the rest of the pipeline can consume them unchanged. Each adapter is a pure `(source: unknown) => JSONSchema` function; loading the source module is the CLI's job (`--input <format>` / `--export <name>`).

- **Implemented:** `typebox`, `zod`, `valibot`, and `effect`. Each external library is an optional peer dependency loaded at runtime (so the core stays slim): TypeBox schemas are already JSON-Schema-shaped (strip symbol keys + rewrite extended types); `zod` uses Zod 4's `toJSONSchema`; `valibot` uses `@valibot/to-json-schema`; `effect` uses `JSONSchema.make`. The Zod, Valibot, and TypeBox adapters map their date types to the `x-mjst` Date extension; the Effect adapter passes through Effect's encoded (string) representation.
- **Lossy constructs:** types JSON Schema cannot express are preserved as an `x-mjst` vendor extension rather than dropped. `@amritk/helpers/mjst-extension` defines the shared contract (`MJST_EXTENSION_KEY`, `MjstExtension`, and the readers `getMjstInstanceOf` / `getMjstPrimitive` / `getMjstBrand`), which the type generator, parsers, and validators read to emit the right TypeScript type and runtime checks. The extension currently carries: `instanceOf` (a runtime class such as `Date`, checked with `instanceof`), `primitive` (a non-JSON primitive such as `bigint`, checked with `typeof`), and `brand` (a type-level nominal brand — the value still validates as its base JSON type at runtime, but the generated TypeScript type is intersected with a unique brand). Brands cannot be auto-detected from the source libraries (Zod/Valibot/Effect brands are type-level or stripped during conversion), so they are opt-in via a hand-authored `x-mjst.brand` keyword — which TypeBox passes through from `Type.String({ 'x-mjst': { brand: 'UserId' } })`.

### `@amritk/helpers` (`packages/helpers`)

Shared utility belt used both by the generators and copied into generated output. Each helper is exposed as its own subpath export (`@amritk/helpers/<name>`) so consumers — and generated files — only pull in what they need.

Categories:

- **Schema traversal:** `extract-refs`, `resolve-ref`, `build-dynamic-ref-map`, `resolve-dynamic-refs`, `upgrade-draft07-schema`, `ref-to-filename`, `ref-to-name`, `schema-guards`
- **Codegen utilities:** `generate-type-definition`, `parse-documentation`, `safe-accessor`
- **Runtime helpers (referenced from generated output):** `is-object`, `validate-array`, `validate-record`, `has-ref`. In `--helpers=embedded` mode (default when `@amritk/helpers` is not resolvable from `outDir`), these sources are snapshotted at `@amritk/generate-parsers` build time and emitted into `outDir/_helpers/` so the generated output is self-contained.

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
