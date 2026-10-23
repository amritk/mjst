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
| **Validators** | Error-collecting `validateX` functions plus flat `isX` boolean type guards — and, on request, first-error `checkX`, Ajv-style coercing `coerceX`, and `repairX`, which repairs what it can and reports what it repaired |
| **Type definitions** | TypeScript types matching the schema, with documentation comments (compiled to `.d.ts` under `--build`) |
| **Test data** | fast-check arbitraries for property testing, plus concrete example values |
| **Markdown** | A configuration-reference table for a README, or a multi-page prose reference, rendered from a schema's properties |

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
| [`@amritk/mjst`](./packages/cli) | CLI — generates parsers, validators, types, and test data from a schema; lints JSON/YAML (`mjst lint`); compiles API contracts (`mjst compile-api`); renders schema docs (`mjst markdown`) |
| [`@amritk/api`](./packages/api) | Contract-first, framework-agnostic API layer — typed routes, request/response validation, OpenAPI 3.2, typed client |
| [`@amritk/lint`](./packages/lint) | Format-agnostic JSON/YAML style-guide linter — JSON Schema + custom rules, with exact `line:column` findings |
| [`@amritk/validation`](./packages/validation) | Programmatic API for type, guard, validator, coercer, repairer and parser generation |
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

### Performance

mjst's validators are *generated* TypeScript — straight-line, monomorphic code with no generic dispatch. The exported `validateX` runs a tiny inlined boolean guard on the happy path and falls back to a separate error-collecting function only when input is actually invalid.

Each schema also generates a boolean type-guard `isX(input): input is X` — a single flat predicate (no error array, no cold-path call) returning the same verdict as `validateX`. It is the inline-friendly equivalent of TypeBox's compiled `check` / typia's `is`, for the common "is this valid?" question where you don't need the error list; `validateX` remains the rich, error-collecting form.

The bench suites in [`packages/validation`](./packages/validation) put a generated validator, parser and coercer against typia, an Ajv-compiled function, a TypeBox-compiled checker and a hand-written Zod schema on the same data, on both Bun and Node. What they show, in broad strokes:

- **Validation.** On JavaScriptCore (Bun) the generated validator leads every library measured, typia included. On V8 (Node) it leads on the object schemas — the shapes an application actually validates — while TypeBox's compiled checker takes the `assert-loose` shape and draws level on `assert-strict`.
- **Parsing.** Against the libraries with a pure (non-mutating) parse — zod's `.parse` and TypeBox's `Value.Parse` — the generated parser leads every case on both engines, in both the strip-extras and reject-extras modes. Ajv (`removeAdditional`) and typia (`assertPrune`) are left out because they strip by mutating their input.
- **Coercion.** `coerceX` beats Ajv with `coerceTypes: true` on every case, by the widest margin on input that is already valid, which it hands straight back. It is also stricter where Ajv guesses — no `null` read as `""`/`0`/`false`, no `" "` read as `0` — and coerces inside `anyOf`/`oneOf`/`allOf`/`if` without Ajv's first-branch-wins rewrites; see [Moving off Ajv](./packages/validation/README.md#moving-off-ajv).
- **Preparing a validator.** Generating code is far cheaper than Ajv's compile, though TypeBox's compile is cheaper still — and mjst normally pays it once, at build time.

Every library must agree on each valid/invalid verdict (and, for parsers, on the parsed output) before anything is timed. The `assert-loose` / `assert-strict` cases use the same *shape* as [`moltar/typescript-runtime-type-benchmarks`](https://github.com/moltar/typescript-runtime-type-benchmarks), but not its harness, so the results are not comparable with that project's leaderboard; `bun run bench:validators:moltar` runs the same functions under its benny harness to show how much the harness itself moves the figures.

The numbers depend on the engine, its version and the machine, so they are not quoted here — run the suites yourself:

```bash
cd packages/validation
bun run bench:validators          # validators (Bun); bench:validators:node for Node
bun run bench:parsers             # parsers (Bun); bench:parsers:node for Node
bun run bench:validators:coerce   # coercion (Bun); bench:validators:coerce:node for Node
```

Every pull request that touches runtime code also gets a benchmark delta against its base branch in its description, from the [Bench workflow](./.github/workflows/bench.yml).

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
