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

It is **format-agnostic**: the engine ships no built-in ruleset and knows nothing about OpenAPI or any other schema — you bring the rules. This is JSON/YAML style-guide linting with JSON Schema and custom rules, and nothing else.

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

## License

MIT
