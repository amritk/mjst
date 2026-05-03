<div align="center">

# mjst — More JSON Schema Tools

**Generate fast, type-safe TypeScript parsers, validators, and type definitions from JSON Schemas.**

![status](https://img.shields.io/badge/status-pre--alpha-ef4444?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)
![JSON Schema](https://img.shields.io/badge/JSON%20Schema-2020--12-f97316?style=flat-square)
![bun](https://img.shields.io/badge/bun-required-FBF0DF?style=flat-square&logo=bun&logoColor=000000)

</div>

> [!WARNING]
> mjst is pre-alpha. APIs and generated output will change without notice until 1.0.

## What is mjst?

mjst is a monorepo of code-generation tools that turn a JSON Schema (Draft 2020-12, OpenAPI 2.0 / 3.0 / 3.1 / 3.2, AsyncAPI 3.1) into TypeScript:

- **Parsers** — runtime functions that validate and coerce unknown input into typed values
- **Validators** — lightweight predicate-style validation functions
- **Type definitions** — `.d.ts` types matching the schema, with documentation comments
- **Markdown** — reference docs derived from the schema

The CLI (`mjst`) is the primary entry point; the underlying generators are also published as standalone packages.

## Packages

| Package | Description |
|---|---|
| [`mjst-cli`](./packages/cli) | Command-line interface — generates parsers, validators, and types from a schema |
| [`generate-parsers`](./packages/generate-parsers) | Programmatic API for parser + type generation |
| [`generate-validators`](./packages/generate-validators) | Programmatic API for validator generation |
| [`generate-markdown`](./packages/generate-markdown) | Programmatic API for markdown documentation generation |
| [`mjst-helpers`](./packages/helpers) | Shared runtime helpers used by generated code |

## Quick start

Install the CLI:

```bash
bun add -d mjst-cli
```

Generate parsers and types from a schema:

```bash
bunx mjst --schema ./schema.json --outDir ./generated
```

Or use a config file:

```bash
bunx mjst --config ./mjst.config.json
```

See the [CLI README](./packages/cli/README.md) for the full flag reference.

## Requirements

- [Bun](https://bun.sh) ≥ 1.1 (the CLI uses Bun's shell APIs at build time)
- TypeScript ≥ 5 in your consuming project

## Development

```bash
bun install
bun test            # run the test suite
bun run check       # lint with biome
bun run build       # build all publishable packages
bun run bench       # run benchmarks
```

See [`.claude/architecture.md`](./.claude/architecture.md) for monorepo layout and design notes, and [`CONTRIBUTING.md`](./CONTRIBUTING.md) for contribution guidelines.

## License

[MIT](./LICENSE)
