<div align="center">

# mjst — More JSON Schema Tools

**Generate fast, type-safe TypeScript parsers, validators, and type definitions from JSON Schemas.**

![status](https://img.shields.io/badge/status-pre--alpha-ef4444?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)
![JSON Schema](https://img.shields.io/badge/JSON%20Schema-2020--12-f97316?style=flat-square)
![node](https://img.shields.io/badge/node-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white)
![vibe coded](https://img.shields.io/badge/vibe%20coded-86%25-a855f7?style=flat-square)

</div>

> [!WARNING]
> mjst is pre-alpha. APIs and generated output will change without notice until 1.0.

## What is mjst?

mjst is a monorepo of code-generation tools that turn a JSON Schema (Draft 2020-12) into TypeScript:

- **Parsers** — runtime functions that validate and coerce unknown input into typed values
- **Validators** — lightweight predicate-style validation functions
- **Type definitions** — `.d.ts` types matching the schema, with documentation comments
- **Markdown** — reference docs derived from the schema

The CLI (`mjst`) is the primary entry point; the underlying generators are also published as standalone packages.

## Packages

| Package | Description |
|---|---|
| [`@amritk/mjst`](./packages/cli) | Command-line interface — generates parsers, validators, and types from a schema |
| [`@amritk/generate-parsers`](./packages/generate-parsers) | Programmatic API for parser + type generation |
| [`@amritk/generate-validators`](./packages/generate-validators) | Programmatic API for validator generation |
| [`@amritk/generate-markdown`](./packages/generate-markdown) | Programmatic API for markdown documentation generation |
| [`@amritk/helpers`](./packages/helpers) | Shared runtime helpers used by generated code |

## Quick start

Run the CLI without installing:

```bash
npx @amritk/mjst --schema ./schema.json --outDir ./generated
# or
pnpx @amritk/mjst --schema ./schema.json --outDir ./generated
```

Or add it as a dev dependency:

```bash
npm install --save-dev @amritk/mjst
# or
pnpm add -D @amritk/mjst
```

Use a config file:

```bash
npx @amritk/mjst --config ./mjst.config.json
```

See the [CLI README](./packages/cli/README.md) for the full flag reference.

## Requirements

- [Node.js](https://nodejs.org) ≥ 20
- TypeScript ≥ 5 in your consuming project (only required if you use `--build`)

## Development

This repo uses [pnpm](https://pnpm.io) workspaces.

```bash
pnpm install
pnpm test            # run the test suite (vitest)
pnpm run check       # lint with biome
pnpm run typecheck   # type-check every package
pnpm run build       # build all publishable packages
```

See [`.claude/architecture.md`](./.claude/architecture.md) for monorepo layout and design notes, and [`CONTRIBUTING.md`](./CONTRIBUTING.md) for contribution guidelines.

## License

[MIT](./LICENSE)
