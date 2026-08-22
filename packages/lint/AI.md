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
5. **OpenAPI and AsyncAPI support are separate subpaths**,
   `@amritk/lint/rules/openapi` (`createOpenApiRuleset`, `oas`, `oasFixers`, …)
   and `@amritk/lint/rules/asyncapi` (`createAsyncApiRuleset`, `asyncapi`, …) —
   not the package root. Build one with `createOpenApiRuleset()` /
   `createAsyncApiRuleset()` and hand the *result* to `lintDocument` /
   `fixDocument` as `ruleset`. Passing the `oas` or `asyncapi` definition as data
   instead silently produces nothing: its custom functions are unknown at the
   package root, and its `formats` gate matches nothing without that spec's
   detectors.
6. **A ruleset is privileged; a document is not.** Linted documents cannot
   execute anything, and `[?(...)]` filters in a `given` are parsed and
   interpreted rather than evaluated as JavaScript. But `extends` follows any
   path (absolute or `../`-escaping) and `require`s `.js` targets and custom
   functions — that is code execution by design. Load rulesets from sources you
   would trust to run a script, or pass `restrictTo: '<root>'` to confine
   `extends`/`functions` resolution to one directory tree. See the README's
   "Trust boundary" section.
7. **`createRuleset` is memoized** per `(definition object, basePath,
   restrictTo)`. Mutating a definition you already passed in will not rebuild the
   ruleset — pass a fresh object instead.
8. **Most AsyncAPI rules are gated per major** (11 of the 55 apply to both).
   The 3.x-only rules are named with an
   `asyncapi-3-` prefix (`asyncapi-3-operation-description`) and the 2.x ones are
   not, because 3.0 moved operations to the top level and tags under `info`.
   Re-severitying `asyncapi-operation-description` does nothing to a 3.0
   document. The structural rules pick their meta-schema from the `asyncapi`
   field, and a version with no bundled schema (a future `2.7`, say) reports
   nothing rather than being judged against a neighbouring version's.

## Exports

- `lintDocument(input, options?)` → findings only. `options.ruleset` is either a
  definition to build or an already-built `Ruleset`.
- `lintDocumentWithResult(input, options?)` → `{ diagnostics, output?, pluginData }`.
- `fixDocument(input, options?)` → `{ output, fixed, applied, remaining, converged, passes }`
  (needs `fixers`; `converged: false` means the 10-pass cap was hit with the
  document still changing).
- `createRuleset(def?, basePath?, { restrictTo }?)`,
  `resolveNamedRuleset(name, basePath?, { restrictTo }?)`,
  `builtinFunctions` (`alphabetical`, `casing`, `truthy`, `pattern`, `schema`, …).

## Subpaths

| Import | Purpose |
|---|---|
| `@amritk/lint` | core engine, `lintDocument`/`fixDocument`, built-in functions |
| `@amritk/lint/rules/openapi` | ready-made OpenAPI preset (`createOpenApiRuleset`, `oas`) |
| `@amritk/lint/rules/asyncapi` | ready-made AsyncAPI 2.x/3.x preset (`createAsyncApiRuleset`, `asyncapi`) |

Install: `bun add @amritk/lint`.
