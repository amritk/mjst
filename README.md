<div align="center">

# mjst — More JSON Schema Tools

**Fast, type-safe TypeScript parsers, validators, types, docs, and test data — generated from JSON Schema. Plus a JSON/YAML linter to keep the schemas themselves in shape.**

![status](https://img.shields.io/badge/status-pre--alpha-ef4444?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)
![JSON Schema](https://img.shields.io/badge/JSON%20Schema-2020--12-f97316?style=flat-square)
![node](https://img.shields.io/badge/node-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white)
![bun](https://img.shields.io/badge/bun-dev-FBF0DF?style=flat-square&logo=bun&logoColor=000000)
![vibe coded](https://img.shields.io/badge/vibe-coded-a855f7?style=flat-square)

</div>

> [!WARNING]
> mjst is pre-alpha. APIs and generated output will change without notice until 1.0.

---

## What is mjst?

mjst is a monorepo of JSON Schema (Draft 2020-12) tooling for TypeScript. At its core are code generators that turn a schema into:

| Output | Description |
|:---|:---|
| **Parsers** | Runtime functions that validate and coerce unknown input into typed values |
| **Validators** | Error-collecting `validateX` functions plus flat `isX` boolean type guards |
| **Type definitions** | `.d.ts` types matching the schema, with documentation comments |
| **Test data** | fast-check arbitraries for property testing, plus concrete example values |
| **Markdown** | Reference docs derived from the schema |

Around the generators sits a wider toolbox:

- **Linting** — `mjst lint` checks JSON/YAML documents against JSON Schema and custom style rules, with exact `line:column` findings
- **Adapters** — consume schemas authored in TypeBox, Zod, Valibot, or Effect as input
- **`$ref` resolution** — resolve and inline JSON Schema / OpenAPI `$ref`s, with a default-deny SSRF guard
- **Runtime validation** — fast validation for schemas you don't know ahead of time
- **YAML parsing** — a tiny, dependency-free YAML parser that keeps exact source positions

The CLI (`mjst`) is the primary entry point; everything above is also published as a standalone package — see [Packages](#packages) below.

---

## Packages

| Package | Description |
|:---|:---|
| [`@amritk/mjst`](./packages/cli) | CLI — generates parsers, validators, and types from a schema, and lints JSON/YAML (`mjst lint`) |
| [`@amritk/api`](./packages/api) | Contract-first, framework-agnostic API layer — typed routes, request/response validation, OpenAPI 3.1, typed client |
| [`@amritk/mini`](./packages/mini) | Deliberately tiny signals-based UI layer — reactive DOM bindings and a compilerless JSX runtime, with tree-shakeable `router` / `flow` / `forms` / `query` subpaths |
| [`@amritk/lint`](./packages/lint) | Format-agnostic JSON/YAML style-guide linter — JSON Schema + custom rules, with exact `line:column` findings |
| [`@amritk/generate-parsers`](./packages/generate-parsers) | Programmatic API for parser + type generation |
| [`@amritk/generate-validators`](./packages/generate-validators) | Programmatic API for validator generation |
| [`@amritk/runtime-validators`](./packages/runtime-validators) | Runtime JSON Schema validation for schemas not known ahead of time |
| [`@amritk/generate-examples`](./packages/generate-examples) | Programmatic API for fast-check arbitraries + example data generation |
| [`@amritk/generate-markdown`](./packages/generate-markdown) | Programmatic API for markdown documentation generation |
| [`@amritk/adapters`](./packages/adapters) | Convert schemas from external libraries (TypeBox, Zod, Valibot, Effect) into JSON Schema |
| [`@amritk/resolve-refs`](./packages/resolve-refs) | Resolve and inline JSON Schema / OpenAPI `$ref`s, with a default-deny SSRF guard |
| [`@amritk/yaml`](./packages/yaml) | Tiny, dependency-free YAML parser with exact source positions for diagnostics |
| [`@amritk/helpers`](./packages/helpers) | Shared runtime helpers used by generated code |

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

mjst's validators are *generated* TypeScript — straight-line, monomorphic code with no generic dispatch. The exported `validateX` runs a tiny inlined boolean guard on the happy path and falls back to a separate error-collecting function only when input is actually invalid, so a valid-input check matches or beats every other library measured — running clear of the build-time transformer typia on most shapes and neck-and-neck with it on the flat `assert-loose` case. The numbers below compare a generated mjst validator against typia, an Ajv-compiled function, a TypeBox-compiled checker, and a hand-written Zod schema on the same data.

Each schema also generates a boolean type-guard `isX(input): input is X` — a single flat predicate (no error array, no cold-path call) returning the same verdict as `validateX`. It is the inline-friendly equivalent of TypeBox's compiled `check` / typia's `is`, for the common "is this valid?" question where you don't need the error list; `validateX` remains the rich, error-collecting form.

**Steady-state throughput** (valid input, higher is better):

| schema | mjst (generated) | typia (transformed) | ajv (compiled) | typebox (compiled) | zod |
|:--|--:|--:|--:|--:|--:|
| small (4 fields) | **~48M** ops/s | ~5M ops/s | ~10.5M ops/s | ~5.3M ops/s | ~2M ops/s |
| order (nested + array) | **~7.8M** ops/s | ~2.2M ops/s | ~3.5M ops/s | ~2.1M ops/s | ~0.5M ops/s |
| assert-loose | **~184M** ops/s | ~183M ops/s | ~45M ops/s | ~63M ops/s | ~3.8M ops/s |
| assert-strict | **~162M** ops/s | ~148M ops/s | ~22M ops/s | ~38M ops/s | ~1.3M ops/s |

The `assert-loose` / `assert-strict` rows are the exact shape used by [`moltar/typescript-runtime-type-benchmarks`](https://github.com/moltar/typescript-runtime-type-benchmarks).

**Prepare-a-validator cost** (one-shot, lower is better):

| | mjst (codegen) | ajv (compile) | typebox (compile) | zod |
|:--|--:|--:|--:|--:|
| small | ~0.4 ms | ~10 ms | ~0.12 ms | n/a — authored in code |
| order | ~0.5 ms | ~11 ms | ~0.19 ms | n/a — authored in code |

<sub>Measured on Bun 1.3 (Linux x64); micro-benchmark figures vary by machine and runtime. Each library is timed in an isolated process over a pool of distinct inputs, reporting the median of many trials (so the optimiser can't hoist or eliminate the work). Every library agrees on each valid/invalid verdict — parity is asserted before timing — and TypeBox is given uuid/email format checkers so every library does the same work. Reproduce with `cd packages/generate-validators && bun run bench`.</sub>

**Parsing** replicates both parse modes of the same benchmark over the libraries
with a pure (non-mutating) parse operation. *parseSafe* asserts the types and
**strips** undeclared keys (zod's `.strip()`); *parseStrict* asserts the types
and **rejects** undeclared keys (zod's `.strict()`):

| schema | mjst (generated) | zod (`.parse`) | typebox (`Value.Parse`) |
|:--|--:|--:|--:|
| **parseSafe** — strip extras | | | |
| small (4 fields) | **~16M** ops/s | ~3.3M ops/s | ~1.3M ops/s |
| order (nested + array) | **~5.8M** ops/s | ~0.6M ops/s | ~0.18M ops/s |
| assert (moltar shape) | **~95M** ops/s | ~3.7M ops/s | ~0.74M ops/s |
| **parseStrict** — reject extras | | | |
| small (4 fields) | **~13M** ops/s | ~1.8M ops/s | ~1.85M ops/s |
| order (nested + array) | **~7.5M** ops/s | ~0.36M ops/s | ~0.28M ops/s |
| assert (moltar shape) | **~40M** ops/s | ~1.35M ops/s | ~0.97M ops/s |

<sub>mjst parses in `strict` mode throughout (throwing on a type mismatch like the others), adding `stripUnknown` for parseSafe and `additionalProperties: false` for parseStrict; zod uses `.object`/`.strictObject` and TypeBox a `Clean+Assert`/`Assert` pipeline. Parity — identical parsed output, and rejection of every wrong-typed (and, in strict mode, extra-keyed) sample — is asserted before timing. ajv (`removeAdditional`) and typia (`assertPrune`) are excluded because they strip by mutating the input in place rather than returning a new value, which a reused input pool can't measure fairly. Reproduce with `cd packages/generate-parsers && bun run bench`.</sub>

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

## For AI agents & LLMs

Using mjst from a coding agent (Cursor, Claude Code, Copilot, …)? mjst is
pre-alpha, so it isn't in any model's training data — these docs are written to
close that gap:

- **[`llms.txt`](./llms.txt)** — a curated, link-rich index of every package
  ([llmstxt.org](https://llmstxt.org) convention), for agents and docs crawlers.
- **[`llms-full.txt`](./llms-full.txt)** — every package's `AI.md` in one file, to
  paste straight into a model's context.
- **`packages/*/AI.md`** — per package: the mental model, a minimal runnable
  example, and the gotchas most likely to trip up an LLM. Each also ships inside
  the published npm tarball, so an agent can read it from `node_modules`.
- **[`AGENTS.md`](./AGENTS.md)** — for agents *editing this repo* (build/test
  workflow, per-package invariants).

Both `llms.txt` files are generated from the packages by `bun run generate-llms`,
so they stay in sync with the source.

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
