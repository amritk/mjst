<div align="center">

# @amritk/lint

**A fast, format-agnostic JSON/YAML style-guide linter — JSON Schema validation and custom rules, with exact `line:column` findings.**

![status](https://img.shields.io/badge/status-pre--alpha-ef4444?style=flat-square)&nbsp;
![version](https://img.shields.io/badge/version-v0.0.0-6366f1?style=flat-square&logo=npm&logoColor=white)&nbsp;
![license](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)&nbsp;
![JSON Schema](https://img.shields.io/badge/JSON%20Schema-2020--12-f97316?style=flat-square)&nbsp;
![node](https://img.shields.io/badge/node-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white)&nbsp;
![vibe coded](https://img.shields.io/badge/vibe-coded-a855f7?style=flat-square)

</div>

---

## Overview

`@amritk/lint` lints **any** JSON or YAML document against a ruleset you define. A rule matches nodes with a **JSONPath** (`given`) and runs a **function** (`then`) over each match — structural validation against a **JSON Schema**, style checks (`casing`, `pattern`, `alphabetical`, `length`, …), or your own custom function. Every finding carries an exact `line:column` range, because the parser keeps source positions on every node.

It is **format-agnostic**: the core engine ships no built-in ruleset and knows nothing about OpenAPI or any other schema — you bring the rules. This is JSON/YAML style-guide linting with JSON Schema and custom rules at its core.

For OpenAPI specifically, the `@amritk/lint/rules/openapi` subpath ships a ready-made preset on top of that engine — see [OpenAPI ruleset](#openapi-ruleset) below.

The CLI lives in the [`mjst`](../cli) binary as `mjst lint`; this package is the programmatic library behind it.

---

## Installation

```bash
npm install @amritk/lint
# or
pnpm add @amritk/lint
# or
bun add @amritk/lint
```

For the command line, install [`@amritk/mjst`](../cli) and run `mjst lint` (see [CLI](#cli) below).

---

## Usage

### Lint a document

```ts
import { lintDocument } from '@amritk/lint'

const ruleset = {
  rules: {
    'require-name': { given: '$', severity: 'error', then: { field: 'name', function: 'truthy' } },
    'name-kebab': { given: '$.name', severity: 'warn', then: { function: 'casing', functionOptions: { type: 'kebab' } } },
  },
}

const findings = await lintDocument('version: 1\n', { ruleset, source: 'service.yaml' })
// → [{ code: 'require-name', message: 'The value must be truthy', path: ['name'],
//      severity: 0, source: 'service.yaml', range: { start: { line: 0, character: 0 }, … } }]
```

`severity` is a `DiagnosticSeverity` — `0` error, `1` warning, `2` info, `3` hint — and `range` is a zero-based `{ line, character }` span you can render a squiggle from.

### Validate against a JSON Schema

The built-in `schema` function runs an arbitrary JSON Schema (Draft 2020-12) over the matched node, via [`@amritk/runtime-validators`](../runtime-validators):

```ts
const ruleset = {
  rules: {
    'config-schema': {
      given: '$',
      severity: 'error',
      then: { function: 'schema', functionOptions: { schema: { type: 'object', required: ['port'], properties: { port: { type: 'integer' } } } } },
    },
  },
}

await lintDocument('port: not-a-number\n', { ruleset })
// → a `config-schema` finding pointing at `port`
```

### Custom functions and `extends`

A ruleset can pull in rules from another file and load custom functions by name (resolved relative to the ruleset that declares them):

```yaml
# .lint.yaml
extends:
  - ./base.yaml            # a file path or an npm package
functions: [no-secrets]    # loaded from ./functions/no-secrets.{js,cjs,mjs}
rules:
  no-secrets:
    given: $..*
    severity: error
    then: { function: no-secrets }
```

```ts
import { lintDocument } from '@amritk/lint'

await lintDocument(source, { ruleset: definition, rulesetBasePath: '/path/to/config/dir', source: 'doc.yaml' })
```

A custom function has the signature `(value, options, context) => { message: string, path?: JsonPath }[]`.

### Auto-fix

`fixDocument` runs the linter and applies a `FixerRegistry` — fixers keyed by rule `code` that map a finding to a formatting-preserving text edit — to a fixpoint, then re-lints:

```ts
import { fixDocument, type FixerRegistry } from '@amritk/lint'

const fixers: FixerRegistry = {
  'no-trailing-slash': {
    fix: ({ diagnostic, data }) => {
      const value = (data as Record<string, unknown>)[diagnostic.path[0] as string]
      return typeof value === 'string' ? { op: 'setValue', path: diagnostic.path, value: value.replace(/\/$/, '') } : undefined
    },
  },
}

const { output, applied, remaining } = await fixDocument('host: api.example.com/\n', { ruleset, fixers })
// output === 'host: api.example.com\n'
```

The engine ships no built-in fixers (rule codes are yours to define), so the default registry is empty and `fixDocument` is a no-op until you supply one.

### Rendering findings

`lintDocument` returns structured `IDiagnostic[]` — each with a `code`, `message`, `path`, `severity`, `source`, and a zero-based `range`. **Rendering is the caller's job**: print them, serialize them to JSON, or map them to whatever your editor or CI consumes. The linter deliberately ships no output "formatter" layer (that is not the same thing as `prettier`/`biome format`, which reformat source).

```ts
const findings = await lintDocument(source, { ruleset, source: 'doc.yaml' })
for (const f of findings) {
  const { line, character } = f.range.start
  console.log(`${f.source}:${line + 1}:${character + 1}  ${f.code}  ${f.message}`)
}
```

### CLI

The [`mjst`](../cli) binary exposes the linter as a subcommand, which prints a compact `file:line:col` report:

```bash
mjst lint "**/*.{yaml,json}" -r .lint.yaml
```

With no `-r`, it discovers a `.lint.{yaml,yml,json,js,mjs}` ruleset by walking up from each file. The exit code is derived from `--fail-severity` (default `error`). See the [CLI README](../cli/README.md#linting) for the full flag reference.

---

## Ruleset format

A ruleset is a plain object (authored as YAML, JSON, or a JS module):

| Field | Description |
| --- | --- |
| `rules` | Map of `name → rule`. A rule has `given` (one or more JSONPath expressions), `then` (a function to run, or a list), `severity` (`error`/`warn`/`info`/`hint`/`off`), and optional `message`, `description`, `formats`, `recommended`. |
| `then` | `{ function, field?, functionOptions? }` — `field` narrows the match to a child (`@key` targets the property name). |
| `extends` | A ruleset (or list) to inherit rules from: a file path or npm package. `[target, 'recommended' \| 'all' \| 'off']` controls what it contributes. |
| `functions` / `functionsDir` | Custom functions to load by name (default dir `functions/`). |
| `overrides` | Per-file-glob rule tweaks. |
| `aliases` | Reusable `given` fragments referenced as `#alias`. |

Built-in functions: `alphabetical`, `casing`, `defined`, `enumeration`, `falsy`, `length`, `pattern`, `schema`, `truthy`, `undefined`, `unreferencedReusableObject`, `xor`, `typedEnum`.

---

## API

| Export | What it does |
| --- | --- |
| `lintDocument(input, options?)` | Parse `input` and lint it against `options.ruleset`; returns `IDiagnostic[]`. |
| `lintDocumentWithResult(input, options?)` | Like `lintDocument`, but returns `{ diagnostics, output?, pluginData }` (including any plugin's rewritten `output`). |
| `fixDocument(input, options?)` | Lint and apply `options.fixers` to a fixpoint; returns `{ output, fixed, applied, remaining }`. |
| `createRuleset(definition?, basePath?)` | Normalize a ruleset definition into a runnable `Ruleset`, layering the built-in functions and resolving `extends`. |
| `resolveNamedRuleset(name, basePath?)` | Resolve an `extends` reference (file path or npm package) to its definition. |
| `builtinFunctions` | The registry of built-in rule functions. |

The engine internals (`createDocument`, `lint`, `query`, `validateRuleset`, `parseWithPointers`, `createFixPlugin`, `DiagnosticSeverity`, and the rule/diagnostic types) are re-exported from the package root for advanced use.

---

## OpenAPI ruleset

The core package is format-agnostic, but OpenAPI is common enough to ship a ready-made preset. It lives at the **`@amritk/lint/rules/openapi`** subpath — a self-contained layer on top of the engine that adds **no dependencies** beyond what `@amritk/lint` already uses.

```ts
import { lint } from '@amritk/lint'
import { createOpenApiRuleset } from '@amritk/lint/rules/openapi'

// Defaults to `extends: [oas]` (recommended rules only, like `spectral:oas`).
const ruleset = createOpenApiRuleset()
const findings = await lint(spec, { ruleset })
```

`createOpenApiRuleset(definition?, basePath?)` builds a runnable `Ruleset` with the OpenAPI functions and format detectors layered over the built-ins, and with `extends` resolution that understands the `oas` / `loupe:oas` / `spectral:oas` names (the last two accepted so existing Spectral-style rulesets extend unchanged). Enable every rule with `createOpenApiRuleset({ extends: [['oas', 'all']] })`, or pass your own definition to override severities, add rules, or point `extends` at a file/npm package.

| Export | What it does |
| --- | --- |
| `createOpenApiRuleset(definition?, basePath?)` | Build a runnable OpenAPI `Ruleset` (functions + formats + `extends` resolution). |
| `resolveOpenApiRuleset(name, basePath?)` | Resolve an `extends` reference, including the `oas` / `loupe:oas` / `spectral:oas` names. |
| `oas` | The built-in OpenAPI ruleset definition. |
| `oasFunctions` / `allFunctions` | The OpenAPI-specific functions; `allFunctions` = built-ins + OpenAPI. |
| `oasFormats` | OpenAPI version detectors (`oas2`, `oas3`, `oas3.0`, `oas3.1`, `oas3.2`). |
| `oasFixers` | Auto-fixers for the mechanically-repairable OpenAPI rules (pass to `fixDocument`). |
| `loadOasSchema(version)` | Lazily load one OpenAPI version's official structural meta-schema (`'2.0'` / `'3.0'` / `'3.1'` / `'3.2'`), vendored as raw `.json` from `spec.openapis.org` (3.0/3.1/3.2 verbatim; 2.0 with its external draft-04 metaschema refs inlined). See [`schemas/README.md`](./src/rules/openapi/schemas/README.md). |

The structural rules validate against the **official `spec.openapis.org` meta-schemas, vendored as raw `.json`** ([`schemas/`](./src/rules/openapi/schemas/)). 3.0/3.1/3.2 are byte-for-byte verbatim; only 2.0 differs (its external draft-04 metaschema refs are inlined, since the offline interpreter never fetches remote refs). OpenAPI 3.1/3.2 express Schema Objects as JSON Schema 2020-12 via a local `$dynamicRef`/`$dynamicAnchor`, which `@amritk/runtime-validators` resolves natively — so the whole document envelope is validated against the official schema with no bundling or dialect engine, while Schema Object internals stay permissive.

`$ref` resolution stays the caller's job: the preset doesn't pull in a resolver, so for rules that need the dereferenced document (`resolved: true`) pass a `resolve` function to the core `lintWithResult` (for example wrapping [`@amritk/resolve-refs`](../resolve-refs)). The `mjst lint` CLI already wires one up.

---

## Benchmarks

The `bench/` suite pits `@amritk/lint` head-to-head against **[Spectral](https://github.com/stoplightio/spectral)** — the OpenAPI linter this package is modelled on (hence the `spectral:oas` alias) — over the real-world specs the test suite lints: Swagger's petstore, the DigitalOcean API, and the OpenAI API (~17 KB to ~2.8 MB, spanning a small config and a genuinely large document). Both do the same job: **parse → dereference internal `$ref`s → run their recommended OpenAPI ruleset** (mjst dereferences in memory with [`@amritk/resolve-refs`](../resolve-refs), exactly as the CLI does; Spectral uses its own default resolver). Representative numbers (Bun 1.3, Linux x64 — your hardware will differ, run `bun run bench` yourself):

| document | size | mjst | Spectral | speedup | findings (mjst / Spectral) |
| --- | ---: | ---: | ---: | ---: | ---: |
| petstore (Swagger) | 17 KB | ~7 ms | ~100 ms | **~14×** | 2 / 2 |
| digitalocean | 105 KB | ~31 ms | ~355 ms | **~12×** | 2411 / 4319 |
| openai | 2.8 MB | ~1.4 s | errored¹ | — | 1278 / — |

¹ Spectral's JSONPath engine (`nimma`) throws on the 2.8 MB OpenAI spec under Bun, so that row is mjst-only; mjst lints it end to end.

Each `lint` figure is the mean wall time of one whole pass — **every rule, not a subset** — dominated by real work: JSONPath matching, the rule functions, and the dereference pass. A fresh document is parsed on every iteration on both sides, matching how the tools are actually called. The finding counts differ because the two rulesets are not byte-identical (different rule implementations and `$ref` resolution), so this is a **throughput** comparison rather than a correctness parity check — but on petstore both land on the same two findings.

**Assembling the ruleset** is timed separately, because a process pays it once and then lints many documents: `createOpenApiRuleset` (compiling every rule's JSONPath and wiring up functions and format detectors) measures **~0.09 ms**, versus **~0.35 ms** for `new Spectral()` + `setRuleset(oas)`. The benchmark warms up before timing and reports the mean over a fixed time budget; micro-benchmark figures vary by machine and runtime.

---

## License

MIT
