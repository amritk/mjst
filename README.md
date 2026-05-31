<div align="center">

# mjst — More JSON Schema Tools

**Generate fast, type-safe TypeScript parsers, validators, and type definitions from JSON Schemas.**

![status](https://img.shields.io/badge/status-pre--alpha-ef4444?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)
![JSON Schema](https://img.shields.io/badge/JSON%20Schema-2020--12-f97316?style=flat-square)
![node](https://img.shields.io/badge/node-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white)
![bun](https://img.shields.io/badge/bun-dev-FBF0DF?style=flat-square&logo=bun&logoColor=000000)
![vibe coded](https://img.shields.io/badge/vibe%20coded-86%25-a855f7?style=flat-square)

</div>

> [!WARNING]
> mjst is pre-alpha. APIs and generated output will change without notice until 1.0.

---

## What is mjst?

mjst is a monorepo of code-generation tools that turn a JSON Schema (Draft 2020-12) into TypeScript:

| Output | Description |
|:---|:---|
| **Parsers** | Runtime functions that validate and coerce unknown input into typed values |
| **Validators** | Lightweight predicate-style validation functions |
| **Type definitions** | `.d.ts` types matching the schema, with documentation comments |
| **Markdown** | Reference docs derived from the schema |

The CLI (`mjst`) is the primary entry point; the underlying generators are also published as standalone packages.

---

## How mjst compares

Most tools in this space pick a single lane — types **or** validation **or** docs. mjst generates the whole TypeScript surface from one schema, and it can also *consume* schemas authored in other libraries as input.

| | Types | Validators | Parsers&nbsp;/&nbsp;coercion | Markdown&nbsp;docs | Test&nbsp;data&nbsp;² | Multi-library&nbsp;input |
|:--|:-:|:-:|:-:|:-:|:-:|:-:|
| **mjst** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [json-schema-to-typescript](https://github.com/bcherny/json-schema-to-typescript) | ✅ | — | — | — | — | — |
| [ajv](https://ajv.js.org/) *(standalone)* | — | ✅ | — | — | — | — |
| [quicktype](https://quicktype.io/) | ✅ | — | 🟡 | — | — | — |
| TypeBox · Zod · Valibot | ✅ | ✅ | ✅ | — | — | n/a&nbsp;¹ |

<sub>✅ first-class · 🟡 partial · — not offered</sub>

<sub>¹ These libraries *are* a schema source rather than a competitor — mjst consumes them via [`@amritk/adapters`](./packages/adapters).</sub>

<sub>² fast-check arbitraries for property testing plus concrete example values, via [`@amritk/generate-examples`](./packages/generate-examples).</sub>

### Benchmarks

mjst's validators are *generated* TypeScript — straight-line, monomorphic code with no generic dispatch — so once they're emitted they validate quickly. The numbers below compare a generated mjst validator against an Ajv-compiled function, a TypeBox-compiled checker, and a hand-written Zod schema on the same data.

**Steady-state throughput** (valid input, higher is better):

| schema | mjst (generated) | ajv (compiled) | typebox (compiled) | zod |
|:--|--:|--:|--:|--:|
| small (4 fields) | **~47M** ops/s | ~7M ops/s | ~3.7M ops/s | ~1.9M ops/s |
| order (nested + array) | **~17M** ops/s | ~2.5M ops/s | ~1.6M ops/s | ~0.45M ops/s |

**Prepare-a-validator cost** (one-shot, lower is better):

| | mjst (codegen) | ajv (compile) | typebox (compile) | zod |
|:--|--:|--:|--:|--:|
| small | ~0.11 ms | ~9 ms | ~0.15 ms | n/a — authored in code |
| order | ~0.11 ms | ~12 ms | ~0.24 ms | n/a — authored in code |

<sub>Measured on Bun 1.3 (Linux x64); micro-benchmark figures vary by machine and runtime. All four libraries agree on every valid/invalid verdict (parity is asserted before timing). TypeBox is compiled with `TypeCompiler` and given uuid/email format checkers so every library does the same work. Reproduce with `cd packages/generate-validators && bun run bench`.</sub>

---

## Quick start

No install required — run it directly with your favourite package runner:

```bash
# npm
npx @amritk/mjst --schema ./schema.json --out-dir ./generated

# pnpm
pnpx @amritk/mjst --schema ./schema.json --out-dir ./generated

# yarn
yarn dlx @amritk/mjst --schema ./schema.json --out-dir ./generated

# bun
bunx @amritk/mjst --schema ./schema.json --out-dir ./generated
```

Or use a config file:

```bash
npx @amritk/mjst --config ./mjst.config.json
```

> [!TIP]
> If you'd rather add it to a project, install it as a dev dependency:
> ```bash
> npm install --save-dev @amritk/mjst   # or pnpm add -D / yarn add -D / bun add -d
> ```
> Then use the shorter `mjst` command in npm scripts or via `npx mjst`.

See the [CLI README](./packages/cli/README.md) for the full flag reference and config file examples.

---

## Packages

| Package | Description |
|:---|:---|
| [`@amritk/mjst`](./packages/cli) | CLI — generates parsers, validators, and types from a schema |
| [`@amritk/generate-parsers`](./packages/generate-parsers) | Programmatic API for parser + type generation |
| [`@amritk/generate-validators`](./packages/generate-validators) | Programmatic API for validator generation |
| [`@amritk/runtime-validators`](./packages/runtime-validators) | Runtime JSON Schema validation for schemas not known ahead of time |
| [`@amritk/generate-examples`](./packages/generate-examples) | Programmatic API for fast-check arbitraries + example data generation |
| [`@amritk/generate-markdown`](./packages/generate-markdown) | Programmatic API for markdown documentation generation |
| [`@amritk/helpers`](./packages/helpers) | Shared runtime helpers used by generated code |

---

## Requirements

- **Node.js ≥ 20** (or **Bun ≥ 1.1**) to run the CLI
- **TypeScript ≥ 5** in your consuming project

Contributing? You'll need [Bun](https://bun.sh) ≥ 1.1 — it's the package manager and bundler for this repo. See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

---

## Development

```bash
bun install
bun run test        # run the test suite
bun run check       # lint with biome
bun run build       # build all publishable packages
```

See [`.claude/architecture.md`](./.claude/architecture.md) for monorepo layout and design notes, and [`CONTRIBUTING.md`](./CONTRIBUTING.md) for contribution guidelines.

---

## License

[MIT](./LICENSE)
