# Architecture

## Overview

`mjst` is a **Bun monorepo** that generates TypeScript type definitions and runtime parser functions from JSON Schema. It targets JSON Schema 2020-12 and OpenAPI 3.x.

## Monorepo Structure

```
mjst/
├── packages/
│   ├── cli/                   # mjst-cli — command-line interface
│   ├── generate-markdown/     # generate-markdown — README generation
│   └── generate-parsers/      # generate-parsers — core code generator
│       ├── generators/        # Code generation functions
│       ├── helpers/           # Schema traversal utilities
│       ├── templates/         # Files copied verbatim into generated output
│       ├── type-guards/       # Runtime type guards for JSON Schema properties
│       ├── types/             # Internal type definitions
│       └── validators/        # Runtime validators (also copied to generated output)
├── fixtures/                  # Real-world schemas used for integration tests
├── .claude/                   # Developer guidelines and rules
└── package.json               # Workspace root (private, no exports)
```

## Packages

### `mjst-cli`

Entry point for the CLI tool. Reads a JSON Schema file, runs the generator, and writes TypeScript files to the output directory.

- **Depends on:** `generate-parsers`
- **Subpath imports:** `#cli/*` → `./*.ts`
- **Bin:** `mjst` → `cli.ts`

### `generate-parsers`

Core code generation engine. Accepts a JSON Schema and produces TypeScript source files — both type definitions and (optionally) runtime parser functions.

- **Subpath imports:**
  - `#generators/*` → `./generators/*.ts`
  - `#helpers/*` → `./helpers/*.ts`
  - `#type-guards/*` → `./type-guards/*.ts`
  - `#types/*` → `./types/*.ts`
  - `#validators/*` → `./validators/*.ts`
  - `#templates/*` → `./templates/*.ts`

**Key entry point:** `generators/build-schema.ts` — traverses the root schema and all `$ref` references recursively, produces an array of `GeneratedFile` objects.

**Template files** ( `templates/schema.ts`) are read at runtime and copied verbatim into the user's output directory. They must use relative imports that work in the output context, not `#` subpath imports.

### `generate-markdown`

Generates a `README.md` from a `config.schema.json` file and the project's `package.json`. Used internally to keep the project README in sync with the schema.

- **Subpath imports:** `#markdown/*` → `./*.ts`

## Import Conventions

- **Within a package:** use `#` subpath imports (e.g. `import { foo } from '#helpers/foo'`)
- **Cross-package:** use the workspace package name (e.g. `import { buildSchema } from 'generate-parsers/generators/build-schema'`)
- **Same directory:** use relative `./` imports

**Exception:** template files that are copied into user output directories must use relative `../` imports so the paths remain valid after being written to a different location.

## Generation Pipeline

```
JSON Schema file
       │
       ▼
  mjst-cli (cli.ts)
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
  (including runtime helper copies: validators/, helpers/, schema.ts)
```

## Testing

- **Framework:** `bun test`
- **Convention:** test files colocated with implementation, named `*.test.ts`
- **Fixtures:** real-world OpenAPI and AsyncAPI schemas in `fixtures/` for integration tests
- **No mocking** except where necessary (e.g. `generate-markdown` tests mock `node:fs/promises`)

Run all tests:

```sh
bun test
```

Run tests for a specific package:

```sh
bun test ./packages/generate-parsers/
```

## Design Principles

- **Functional programming:** one function per file, no classes
- **Type safety:** strict TypeScript throughout, comprehensive type guards
- **Template-based output:** runtime helper files are source files that get copied into user projects
- **Extensible:** `SchemaExtensions` allows injecting additional properties into specific definitions before generation
