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

mjst's validators are *generated* TypeScript — straight-line, monomorphic code with no generic dispatch. The exported `validateX` runs a tiny inlined boolean guard on the happy path and falls back to a separate error-collecting function only when input is actually invalid, so a valid-input check beats every other library measured — including the build-time transformer typia. The numbers below compare a generated mjst validator against typia, an Ajv-compiled function, a TypeBox-compiled checker, and a hand-written Zod schema on the same data.

**Steady-state throughput** (valid input, higher is better):

| schema | mjst (generated) | typia (transformed) | ajv (compiled) | typebox (compiled) | zod |
|:--|--:|--:|--:|--:|--:|
| small (4 fields) | **~22M** ops/s | ~4.2M ops/s | ~7.0M ops/s | ~4.0M ops/s | ~1.8M ops/s |
| order (nested + array) | **~6.9M** ops/s | ~1.7M ops/s | ~2.5M ops/s | ~1.7M ops/s | ~0.4M ops/s |
| assert-loose | **~110M** ops/s | ~100M ops/s | ~31M ops/s | ~41M ops/s | ~3.2M ops/s |
| assert-strict | **~98M** ops/s | ~82M ops/s | ~13M ops/s | ~28M ops/s | ~1.1M ops/s |

The `assert-loose` / `assert-strict` rows are the exact shape used by [`moltar/typescript-runtime-type-benchmarks`](https://github.com/moltar/typescript-runtime-type-benchmarks).

**Prepare-a-validator cost** (one-shot, lower is better):

| | mjst (codegen) | ajv (compile) | typebox (compile) | zod |
|:--|--:|--:|--:|--:|
| small | ~0.15 ms | ~13 ms | ~0.12 ms | n/a — authored in code |
| order | ~0.20 ms | ~14 ms | ~0.21 ms | n/a — authored in code |

<sub>Measured on Bun 1.3 (Linux x64); micro-benchmark figures vary by machine and runtime. Each library is timed in an isolated process over a pool of distinct inputs, reporting the median of many trials (so the optimiser can't hoist or eliminate the work). Every library agrees on each valid/invalid verdict — parity is asserted before timing — and TypeBox is given uuid/email format checkers so every library does the same work. Reproduce with `cd packages/generate-validators && bun run bench`.</sub>

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
| [`@amritk/adapters`](./packages/adapters) | Convert schemas from external libraries (TypeBox, Zod, …) into JSON Schema |
| [`@amritk/resolve-refs`](./packages/resolve-refs) | Resolve and inline JSON Schema / OpenAPI `$ref`s, with a default-deny SSRF guard |
| [`@amritk/yaml`](./packages/yaml) | Tiny, dependency-free YAML parser with exact source positions for diagnostics |
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
