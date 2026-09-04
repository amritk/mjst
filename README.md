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
| **Type definitions** | TypeScript types matching the schema, with documentation comments (compiled to `.d.ts` under `--build`) |
| **Test data** | fast-check arbitraries for property testing, plus concrete example values |
| **Markdown** | A configuration-reference table rendered from a schema's properties |

Around the generators sits a wider toolbox:

- **API layer** — `@amritk/api` turns route contracts into typed handlers, request/response validation, an OpenAPI 3.2 document, and a typed client
- **Linting** — `mjst lint` checks JSON/YAML documents against JSON Schema and custom style rules, with exact `line:column` findings
- **Adapters** — consume schemas authored in TypeBox, Zod, Valibot, Effect, or Apache Avro (`.avsc`) as input
- **`$ref` resolution** — resolve and inline JSON Schema / OpenAPI `$ref`s, with a default-deny SSRF guard
- **Runtime validation** — fast validation for schemas you don't know ahead of time
- **YAML parsing** — a tiny, dependency-free YAML parser that keeps exact source positions

The CLI (`mjst`) is the primary entry point; everything above is also published as a standalone package — see [Packages](#packages) below.

---

## Packages

| Package | Description |
|:---|:---|
| [`@amritk/mjst`](./packages/cli) | CLI — generates parsers, validators, types, and test data from a schema; lints JSON/YAML (`mjst lint`); compiles API contracts (`mjst compile-api`) |
| [`@amritk/api`](./packages/api) | Contract-first, framework-agnostic API layer — typed routes, request/response validation, OpenAPI 3.2, typed client |
| [`@amritk/lint`](./packages/lint) | Format-agnostic JSON/YAML style-guide linter — JSON Schema + custom rules, with exact `line:column` findings |
| [`@amritk/generate-parsers`](./packages/generate-parsers) | Programmatic API for parser + type generation |
| [`@amritk/generate-validators`](./packages/generate-validators) | Programmatic API for validator generation |
| [`@amritk/runtime-validators`](./packages/runtime-validators) | Runtime JSON Schema validation for schemas not known ahead of time |
| [`@amritk/generate-examples`](./packages/generate-examples) | Programmatic API for fast-check arbitraries + example data generation |
| [`@amritk/generate-markdown`](./packages/generate-markdown) | Renders a config schema as documentation — a README table, or a multi-page prose reference |
| [`@amritk/adapters`](./packages/adapters) | Convert schemas from external libraries (TypeBox, Zod, Valibot, Effect, Apache Avro) into JSON Schema |
| [`@amritk/asyncapi`](./packages/asyncapi) | Extract message schemas from AsyncAPI 2.x/3.0 documents for the generators (`--input asyncapi`) |
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

mjst's validators are *generated* TypeScript — straight-line, monomorphic code with no generic dispatch. The exported `validateX` runs a tiny inlined boolean guard on the happy path and falls back to a separate error-collecting function only when input is actually invalid, so a valid-input check matches or beats every other library measured — running clear of the build-time transformer typia on every shape measured — comfortably on the object schemas and on `assert-strict`, and by a narrower margin on `assert-loose`, where the two are close enough to trade the lead run-to-run. The numbers below compare a generated mjst validator against typia, an Ajv-compiled function, a TypeBox-compiled checker, and a hand-written Zod schema on the same data.

Each schema also generates a boolean type-guard `isX(input): input is X` — a single flat predicate (no error array, no cold-path call) returning the same verdict as `validateX`. It is the inline-friendly equivalent of TypeBox's compiled `check` / typia's `is`, for the common "is this valid?" question where you don't need the error list; `validateX` remains the rich, error-collecting form.

**Steady-state throughput** (valid input, higher is better):

| schema | mjst (generated) | typia (transformed) | ajv (compiled) | typebox (compiled) | zod |
|:--|--:|--:|--:|--:|--:|
| small (4 fields) | **~33M** ops/s | ~4.2M ops/s | ~6.1M ops/s | ~5.6M ops/s | ~1.7M ops/s |
| order (nested + array) | **~6.3M** ops/s | ~1.6M ops/s | ~2.6M ops/s | ~2.5M ops/s | ~0.41M ops/s |
| assert-loose | **~111M** ops/s | ~88M ops/s | ~27M ops/s | ~48M ops/s | ~2.8M ops/s |
| assert-strict | **~63M** ops/s | ~34M ops/s | ~13M ops/s | ~29M ops/s | ~0.99M ops/s |

The `assert-loose` / `assert-strict` rows use the same *shape* as [`moltar/typescript-runtime-type-benchmarks`](https://github.com/moltar/typescript-runtime-type-benchmarks) — they are not that project's numbers, and they are not comparable with its leaderboard. The shape is shared; the harness is not, and the harness is worth an order of magnitude. Every operation on the leaderboard goes through benny (benchmark.js) into a class-property call, around a single frozen module-level fixture whose verdict is discarded. Running the same generated functions under that harness (`bun run bench:moltar`, one run on Linux x64, Bun 1.4.0 / Node 22.22):

| harness | runtime | assert-loose | assert-strict |
|:--|:--|--:|--:|
| this table (`bench/measure.ts`) | Bun | ~200M ops/s | ~185M ops/s |
| benny, moltar's `Benchmark` class | Node | ~100M ops/s | ~38M ops/s |
| benny, moltar's `Benchmark` class | Bun | ~70M ops/s | ~2.4M ops/s |
| *no-op control, same harness* | *Node* | *~120M ops/s* | *~120M ops/s* |

The no-op row is a "validator" that checks nothing, so it is the fastest number that harness can produce: on Node the `assert-loose` figure lands within 20% of it, which is a measurement of benny, not of validation — the leaderboard's ceiling, not any library's, and on CI hardware that ceiling sits lower still. And `assert-strict` on Bun collapses because moltar's fixture is `Object.freeze({ … })`, which costs *every* library about 100x on JavaScriptCore (details and the frozen-input benchmark: [Frozen inputs](./packages/generate-validators#frozen-inputs)).

**Frozen inputs are their own workload — on older Bun.** Enforcing `additionalProperties: false` means proving no undeclared key is there, and every library does that by enumerating keys. On JavaScriptCore under Bun 1.3, making an object non-extensible (`Object.freeze`, `Object.seal`, `Object.preventExtensions`) disabled the engine's cached own-keys fast path, so every key sweep — `Object.keys`, `for...in`, `Reflect.ownKeys` — dropped to a generic walk. Property reads were unaffected; only strict schemas paid. Bun 1.4.0 no longer shows the cliff: frozen and mutable input run at the same speed for every library. Frozen config objects and frozen fixtures are ordinary inputs, so the bench keeps measuring them (`assert-strict (frozen)`, `small (4 fields, frozen)`), and the table carries both runtimes on the same machine:

| `assert-strict`, valid input | Bun 1.4.0 mutable | Bun 1.4.0 frozen | Bun 1.3.11 mutable | Bun 1.3.11 frozen |
|:--|--:|--:|--:|--:|
| mjst (generated) | ~63M ops/s | ~67M ops/s | ~82M ops/s | ~1.5M ops/s |
| typia (transformed) | ~34M ops/s | ~48M ops/s | ~37M ops/s | ~1.5M ops/s |
| typebox (compiled) | ~29M ops/s | ~26M ops/s | ~27M ops/s | ~1.4M ops/s |
| ajv (compiled) | ~13M ops/s | ~13M ops/s | ~12M ops/s | ~1.2M ops/s |
| zod | ~0.99M ops/s | ~1.0M ops/s | ~0.91M ops/s | ~0.47M ops/s |

On Bun 1.3 everything converged because everything was paying the same engine slow path; V8 never had the cliff, and Bun 1.4 has closed it. [Frozen inputs](./packages/generate-validators#frozen-inputs) has the alternatives that were measured and why the generated code keeps the key count.

**Prepare-a-validator cost** (one-shot, lower is better):

| | mjst (codegen) | ajv (compile) | typebox (compile) | zod |
|:--|--:|--:|--:|--:|
| small | ~0.58 ms | ~15 ms | ~0.21 ms | n/a — authored in code |
| order | ~0.88 ms | ~18 ms | ~0.34 ms | n/a — authored in code |

<sub>Measured on Bun 1.4.0 (Linux x64, a 4-vCPU cloud box — every table in this repo comes from the same machine and runtime); micro-benchmark figures vary by machine and runtime. Each library is timed in an isolated process over a pool of distinct inputs, reporting the median of many trials (so the optimiser can't hoist or eliminate the work). Every library agrees on each valid/invalid verdict — parity is asserted before timing — and TypeBox is given uuid/email format checkers so every library does the same work. Reproduce with `cd packages/generate-validators && bun run bench`.</sub>

**Parsing** replicates both parse modes of the same benchmark — its modes and
its shapes, under this repo's harness rather than the leaderboard's, with the
same caveat as above — over the libraries
with a pure (non-mutating) parse operation. *parseSafe* asserts the types and
**strips** undeclared keys (zod's `.strip()`); *parseStrict* asserts the types
and **rejects** undeclared keys (zod's `.strict()`):

| schema | mjst (generated) | zod (`.parse`) | typebox (`Value.Parse`) |
|:--|--:|--:|--:|
| **parseSafe** — strip extras | | | |
| small (4 fields) | **~100M** ops/s ³ | ~2.2M ops/s | ~1.2M ops/s |
| order (nested + array) | **~5.5M** ops/s | ~0.44M ops/s | ~0.17M ops/s |
| assert (moltar shape) | **~34M** ops/s | ~2.6M ops/s | ~0.58M ops/s |
| **parseStrict** — reject extras | | | |
| small (4 fields) | **~24M** ops/s | ~1.3M ops/s | ~1.5M ops/s |
| order (nested + array) | **~7.7M** ops/s | ~0.26M ops/s | ~0.28M ops/s |
| assert (moltar shape) | **~30M** ops/s | ~0.97M ops/s | ~0.83M ops/s |

<sub>mjst parses in `strict` mode throughout (throwing on a type mismatch like the others), adding `stripUnknown` for parseSafe and `additionalProperties: false` for parseStrict; zod uses `.object`/`.strictObject` and TypeBox a `Clean+Assert`/`Assert` pipeline. Parity — identical parsed output, and rejection of every wrong-typed (and, in strict mode, extra-keyed) sample — is asserted before timing. ajv (`removeAdditional`) and typia (`assertPrune`) are excluded because they strip by mutating the input in place rather than returning a new value, which a reused input pool can't measure fairly. Reproduce with `cd packages/generate-parsers && bun run bench`. ³ The bench flags this cell as noisy (±10% across trials): a four-key strip parse is short enough that run-to-run swing matters, so read the ratio rather than the absolute.</sub>

---

## Quick start

No install required — run it directly with your favourite package runner:

```bash
# npm
npx @amritk/mjst --schema ./schema.json --out-dir ./generated

# pnpm
pnpm dlx @amritk/mjst --schema ./schema.json --out-dir ./generated

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

- **Node.js ≥ 20** (or **Bun**) to run the CLI
- **TypeScript ≥ 5** in your consuming project

Contributing? You'll need [Bun](https://bun.sh) — the repo pins 1.4 via `packageManager` — it's the package manager and bundler for this repo. See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

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
