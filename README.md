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

mjst's validators are *generated* TypeScript — straight-line, monomorphic code with no generic dispatch. The exported `validateX` runs a tiny inlined boolean guard on the happy path and falls back to a separate error-collecting function only when input is actually invalid. On JavaScriptCore that beats every other library measured, the build-time transformer typia included. On V8 it still leads on the object schemas — the shapes an application actually validates — but TypeBox's compiled checker takes the `assert-loose` moltar shape outright and draws level on `assert-strict`, so both engines get a row rather than one standing in for the other. The numbers below compare a generated mjst validator against typia, an Ajv-compiled function, a TypeBox-compiled checker, and a hand-written Zod schema on the same data.

Each schema also generates a boolean type-guard `isX(input): input is X` — a single flat predicate (no error array, no cold-path call) returning the same verdict as `validateX`. It is the inline-friendly equivalent of TypeBox's compiled `check` / typia's `is`, for the common "is this valid?" question where you don't need the error list; `validateX` remains the rich, error-collecting form.

**Steady-state throughput** (valid input, higher is better). Each cell is the median of three runs of the whole suite; typia is Bun-only because its checks come from a compile-time transform delivered as a Bun preload:

| schema | runtime | mjst (generated) | typia (transformed) | ajv (compiled) | typebox (compiled) | zod |
|:--|:--|--:|--:|--:|--:|--:|
| small (4 fields) | Bun | **~59M** ops/s | ~6.7M | ~11M | ~8.9M | ~2.4M |
| small (4 fields) | Node | **~56M** ops/s | n/a | ~7.0M | ~6.6M | ~2.2M |
| order (nested + array) | Bun | **~10M** ops/s | ~2.6M | ~4.1M | ~3.6M | ~0.50M |
| order (nested + array) | Node | **~8.9M** ops/s | n/a | ~2.8M | ~2.9M | ~0.48M |
| assert-loose | Bun | **~190M** ops/s | ~170M | ~46M | ~80M | ~3.6M |
| assert-loose | Node | ~90M ops/s | n/a | ~71M | **~138M** | ~6.0M |
| assert-strict | Bun | **~171M** ops/s | ~58M | ~23M | ~45M | ~1.4M |
| assert-strict | Node | ~37M ops/s | n/a | ~25M | **~37M** | ~3.6M |

The `assert-loose` / `assert-strict` rows use the same *shape* as [`moltar/typescript-runtime-type-benchmarks`](https://github.com/moltar/typescript-runtime-type-benchmarks) — they are not that project's numbers, and they are not comparable with its leaderboard. The shape is shared; the harness is not, and the harness is worth an order of magnitude. Every operation on the leaderboard goes through benny (benchmark.js) into a class-property call, around a single frozen module-level fixture whose verdict is discarded. Running the same generated functions under that harness (`bun run bench:moltar`, one run on Linux x64, Bun 1.4.0 / Node 26.8.1):

| harness | runtime | assert-loose | assert-strict |
|:--|:--|--:|--:|
| this table (`bench/measure.ts`) | Bun | ~190M ops/s | ~171M ops/s |
| this table (`bench/measure.ts`) | Node | ~90M ops/s | ~37M ops/s |
| benny, moltar's `Benchmark` class | Bun | ~90M ops/s | ~76M ops/s |
| benny, moltar's `Benchmark` class | Node | ~80M ops/s | ~34M ops/s |
| *no-op control, same harness* | *Node* | *~91M ops/s* | *~96M ops/s* |
| *no-op control, same harness* | *Bun* | *~508M ops/s (±46%)* | *~449M ops/s (±48%)* |

The no-op row is a "validator" that checks nothing, so it is the fastest number that harness can produce: on Node the `assert-loose` figure lands within 12% of it, which is a measurement of benny, not of validation — the leaderboard's ceiling, not any library's, and on CI hardware that ceiling sits lower still. The harness also reorders the field: under benny on Node the generated validator leads TypeBox (~80M against ~54M), the reverse of what our own harness reports on the same functions and the same engine. And moltar's fixture is `Object.freeze({ … })`, which under Bun 1.3 cost *every* library about 100× on `assert-strict` (the Bun cell read ~2.4M); Bun 1.4.0 has closed that cliff (details and the frozen-input benchmark: [Frozen inputs](./packages/generate-validators#frozen-inputs)).

**Frozen inputs are their own workload — on older Bun.** Enforcing `additionalProperties: false` means proving no undeclared key is there, and every library does that by enumerating keys. On JavaScriptCore under Bun 1.3, making an object non-extensible (`Object.freeze`, `Object.seal`, `Object.preventExtensions`) disabled the engine's cached own-keys fast path, so every key sweep — `Object.keys`, `for...in`, `Reflect.ownKeys` — dropped to a generic walk. Property reads were unaffected; only strict schemas paid. Bun 1.4.0 no longer shows the cliff: frozen and mutable input run at the same speed for every library. Frozen config objects and frozen fixtures are ordinary inputs, so the bench keeps measuring them (`assert-strict (frozen)`, `small (4 fields, frozen)`), and the table carries both runtimes on the same machine:

| `assert-strict`, valid input | Bun 1.4.0 mutable | Bun 1.4.0 frozen | Node 26 mutable | Node 26 frozen | Bun 1.3.11 mutable | Bun 1.3.11 frozen |
|:--|--:|--:|--:|--:|--:|--:|
| mjst (generated) | ~171M ops/s | ~166M ops/s | ~37M ops/s | ~35M ops/s | ~82M ops/s | ~1.5M ops/s |
| typia (transformed) | ~58M ops/s | ~89M ops/s | n/a | n/a | ~37M ops/s | ~1.5M ops/s |
| typebox (compiled) | ~45M ops/s | ~46M ops/s | ~37M ops/s | ~35M ops/s | ~27M ops/s | ~1.4M ops/s |
| ajv (compiled) | ~23M ops/s | ~22M ops/s | ~25M ops/s | ~25M ops/s | ~12M ops/s | ~1.2M ops/s |
| zod | ~1.4M ops/s | ~1.4M ops/s | ~3.6M ops/s | ~3.6M ops/s | ~0.91M ops/s | ~0.47M ops/s |

On Bun 1.3 everything converged because everything was paying the same engine slow path; V8 never had the cliff — the Node columns above are flat, frozen or not — and Bun 1.4 has closed it. [Frozen inputs](./packages/generate-validators#frozen-inputs) has the alternatives that were measured and why the generated code keeps the key count.

**Prepare-a-validator cost** (one-shot, lower is better):

| | runtime | mjst (codegen) | ajv (compile) | typebox (compile) | zod |
|:--|:--|--:|--:|--:|--:|
| small | Bun | ~0.42 ms | ~12 ms | ~0.09 ms | n/a — authored in code |
| small | Node | ~0.29 ms | ~6.2 ms | ~0.05 ms | n/a — authored in code |
| order | Bun | ~0.66 ms | ~13 ms | ~0.23 ms | n/a — authored in code |
| order | Node | ~0.58 ms | ~6.4 ms | ~0.11 ms | n/a — authored in code |

<sub>Measured on Bun 1.4.0 and Node 26.8.1 (Linux x64, a 4-vCPU cloud box — every table in this repo comes from the same machine and runtimes), each cell the median of three runs. Absolutes drift between sittings on that box: the same suite, same commit, read ~60% faster an hour later across every case at once, so the ratios are the durable part. Each library is timed in an isolated process over a pool of distinct inputs, reporting the median of many trials (so the optimiser can't hoist or eliminate the work). Every library agrees on each valid/invalid verdict — parity is asserted before timing — and TypeBox is given uuid/email format checkers so every library does the same work. Reproduce with `cd packages/generate-validators && bun run bench`.</sub>

**Parsing** replicates both parse modes of the same benchmark — its modes and
its shapes, under this repo's harness rather than the leaderboard's, with the
same caveat as above — over the libraries
with a pure (non-mutating) parse operation. *parseSafe* asserts the types and
**strips** undeclared keys (zod's `.strip()`); *parseStrict* asserts the types
and **rejects** undeclared keys (zod's `.strict()`):

| schema | runtime | mjst (generated) | zod (`.parse`) | typebox (`Value.Parse`) |
|:--|:--|--:|--:|--:|
| **parseSafe** — strip extras | | | | |
| small (4 fields) | Bun | **~163M** ops/s ³ | ~3.3M ops/s | ~1.7M ops/s |
| small (4 fields) | Node | **~88M** ops/s ³ | ~4.0M ops/s | ~0.67M ops/s |
| order (nested + array) | Bun | **~7.7M** ops/s | ~0.60M ops/s | ~0.26M ops/s |
| order (nested + array) | Node | **~8.2M** ops/s | ~0.64M ops/s | ~0.15M ops/s |
| assert (moltar shape) | Bun | **~120M** ops/s ³ | ~3.5M ops/s | ~0.87M ops/s |
| assert (moltar shape) | Node | **~66M** ops/s | ~5.3M ops/s | ~0.35M ops/s |
| **parseStrict** — reject extras | | | | |
| small (4 fields) | Bun | **~43M** ops/s | ~1.9M ops/s | ~2.2M ops/s |
| small (4 fields) | Node | **~55M** ops/s | ~2.7M ops/s | ~1.5M ops/s |
| order (nested + array) | Bun | **~13M** ops/s | ~0.36M ops/s | ~0.43M ops/s |
| order (nested + array) | Node | **~8.7M** ops/s | ~0.55M ops/s | ~0.25M ops/s |
| assert (moltar shape) | Bun | **~44M** ops/s | ~1.4M ops/s | ~1.2M ops/s |
| assert (moltar shape) | Node | **~34M** ops/s | ~3.5M ops/s | ~0.80M ops/s |

<sub>mjst parses in `strict` mode throughout (throwing on a type mismatch like the others), adding `stripUnknown` for parseSafe and `additionalProperties: false` for parseStrict; zod uses `.object`/`.strictObject` and TypeBox a `Clean+Assert`/`Assert` pipeline. Parity — identical parsed output, and rejection of every wrong-typed (and, in strict mode, extra-keyed) sample — is asserted before timing. ajv (`removeAdditional`) and typia (`assertPrune`) are excluded because they strip by mutating the input in place rather than returning a new value, which a reused input pool can't measure fairly. Reproduce with `cd packages/generate-parsers && bun run bench` (Bun) or `bun run bench:node` (Node). Unlike the validator table, the generated parser leads every case on both engines. ³ A strip parse of four declared keys builds one small object and nothing else, which is fast enough that the engine's inlining rather than the parser sets the number — read those cells as ratios.</sub>

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
