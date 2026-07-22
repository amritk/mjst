# @amritk/lint — notes for AI coding agents

A fast, format-agnostic JSON/YAML style-guide linter: JSON Schema validation
plus custom rules, emitting findings with exact `line:column` ranges. Full
reference is [README.md](./README.md).

> Pre-alpha: APIs change in **minor** versions.

## Minimal example

```ts
import { lintDocument } from '@amritk/lint'

const ruleset = {
  rules: {
    'require-name': { given: '$', severity: 'error', then: { field: 'name', function: 'truthy' } },
  },
}

const findings = await lintDocument('version: 1\n', { ruleset, source: 'service.yaml' })
```

## Gotchas — where agents fail

1. **Two `severity` vocabularies.** In a **ruleset** you author strings
   (`'error' | 'warn' | 'info' | 'hint' | 'off'`). In a **finding** `severity`
   is **numeric** (`0` error, `1` warn, `2` info, `3` hint). Don't cross them.
2. **Ranges are zero-based** (`{ line, character }` from 0). Add 1 to both to
   print `file:line:col`.
3. **The engine ships no resolver, no built-in ruleset, no fixers.** `$ref`s are
   only dereferenced if you pass a `resolve` hook (e.g. wrapping
   `@amritk/resolve-refs`); `fixDocument` is a no-op until you supply a
   `FixerRegistry`; `createRuleset()` with no argument runs zero rules.
4. **`extends` targets are file paths or npm packages only** — there are no
   named built-in rulesets in core. String `extends` resolve relative to
   `rulesetBasePath` (or the ruleset file's own directory).
5. **OpenAPI support is a separate subpath**, `@amritk/lint/rules/openapi`
   (`createOpenApiRuleset`, `oas`, `oasFixers`, …) — not the package root.

## Exports

- `lintDocument(input, options?)` → findings only.
- `lintDocumentWithResult(input, options?)` → `{ diagnostics, output?, pluginData }`.
- `fixDocument(input, options?)` → `{ output, fixed, applied, remaining }` (needs `fixers`).
- `createRuleset(def?, basePath?)`, `resolveNamedRuleset(name, basePath?)`,
  `builtinFunctions` (`alphabetical`, `casing`, `truthy`, `pattern`, `schema`, …).

## Subpaths

| Import | Purpose |
|---|---|
| `@amritk/lint` | core engine, `lintDocument`/`fixDocument`, built-in functions |
| `@amritk/lint/rules/openapi` | ready-made OpenAPI preset (`createOpenApiRuleset`, `oas`) |

Install: `bun add @amritk/lint`.
