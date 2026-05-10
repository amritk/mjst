# Architecture

## Overview

`mjst` is a **Bun monorepo** that generates TypeScript type definitions and runtime parser functions from JSON Schema (Draft 2020-12).

## Monorepo Structure

```
mjst/
├── packages/
│   ├── cli/                   # @amritk/mjst — command-line interface
│   ├── generate-markdown/     # @amritk/generate-markdown — README generation
│   └── generate-parsers/      # @amritk/generate-parsers — core code generator
│       ├── generators/        # Code generation functions
│       ├── helpers/           # Schema traversal utilities
│       ├── type-guards/       # Runtime type guards for JSON Schema properties
│       ├── types/             # Internal type definitions
│       └── validators/        # Runtime validators (also copied to generated output)
├── .claude/                   # Developer guidelines and rules
└── package.json               # Workspace root (private, no exports)
```

## Packages

### `@amritk/mjst`

Entry point for the CLI tool. Reads a JSON Schema file, runs the generator, and writes TypeScript files to the output directory.

- **Depends on:** `@amritk/generate-parsers`
- **Subpath imports:** `#cli/*` → `./*.ts`
- **Bin:** `mjst` → `cli.ts`

### `@amritk/generate-parsers`

Core code generation engine. Accepts a JSON Schema and produces TypeScript source files — both type definitions and (optionally) runtime parser functions.

- **Subpath imports:**
  - `#generators/*` → `./generators/*.ts`
  - `#helpers/*` → `./helpers/*.ts`
  - `#type-guards/*` → `./type-guards/*.ts`
  - `#types/*` → `./types/*.ts`
  - `#validators/*` → `./validators/*.ts`

**Key entry point:** `generators/build-schema.ts` — traverses the root schema and all `$ref` references recursively, produces an array of `GeneratedFile` objects.

### `@amritk/generate-markdown`

Generates a `README.md` from a `config.schema.json` file and the project's `package.json`. Used internally to keep the project README in sync with the schema.

- **Subpath imports:** `#markdown/*` → `./*.ts`

## Import Conventions

- **Within a package:** use `#` subpath imports (e.g. `import { foo } from '#helpers/foo'`)
- **Cross-package:** use the workspace package name (e.g. `import { buildSchema } from '@amritk/generate-parsers/generators/build-schema'`)
- **Same directory:** use relative `./` imports

## Generation Pipeline

```
JSON Schema file
       │
       ▼
  @amritk/mjst (cli.ts)
       │  reads schema, parses CLI args
       ▼
  buildSchema()                    ← generators/build-schema.ts
       │  traverses $ref graph
       │  resolves $dynamicRef
       │  applies schema extensions
       ▼
  generateFile()                   ← generators/generate-files.ts
  (per schema node)
       ├─ generateTypeDefinition() ← type shape as TypeScript type
       ├─ generateParserFunction() ← runtime coercion/validation (skipped in --types-only mode)
       └─ collectImports()         ← import statements for $ref dependencies
       │
       ▼
  GeneratedFile[]
  { filename, content }
       │
       ▼
  Written to --outDir
  (including runtime helper copies: validators/, helpers/)
```

## Testing

- **Framework:** `vitest`
- **Convention:** test files colocated with implementation, named `*.test.ts`
- **No mocking** except where necessary (e.g. `generate-markdown` tests mock `node:fs/promises`)

Run all tests:

```sh
bun run test
```

Run tests for a specific package:

```sh
bun run test ./packages/generate-parsers/
```

## Design Principles

- **Functional programming:** one function per file, no classes
- **Type safety:** strict TypeScript throughout, comprehensive type guards
- **Extensible:** `SchemaExtensions` allows injecting additional properties into specific definitions before generation
