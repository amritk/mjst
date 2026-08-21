<div align="center">

# @amritk/generate-parsers

**Programmatic API for generating TypeScript parsers and type definitions from JSON Schemas.**

![status](https://img.shields.io/badge/status-pre--alpha-ef4444?style=flat-square)&nbsp;
![version](https://img.shields.io/npm/v/@amritk/generate-parsers?style=flat-square&logo=npm&logoColor=white&label=version&color=6366f1)&nbsp;
![license](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)&nbsp;
![JSON Schema](https://img.shields.io/badge/JSON%20Schema-2020--12-f97316?style=flat-square)&nbsp;
![node](https://img.shields.io/badge/node-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white)&nbsp;
![vibe coded](https://img.shields.io/badge/vibe-coded-a855f7?style=flat-square)

</div>

---

## Overview

`@amritk/generate-parsers` is the core code-generation engine behind [mjst](../../README.md). Given a JSON Schema (Draft 2020-12), it produces an array of `{ filename, content }` records — TypeScript type definitions plus optional runtime parser functions that validate and coerce unknown input.

If you want a CLI, use [`@amritk/mjst`](../cli). Use this package directly when you want to embed schema-to-TypeScript generation inside another build step or tool.

---

## Installation

```bash
npm install @amritk/generate-parsers
# or
pnpm add @amritk/generate-parsers
# or
yarn add @amritk/generate-parsers
# or
bun add @amritk/generate-parsers
```

---

## Usage

```ts
import { buildSchema } from '@amritk/generate-parsers'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

const schema: JSONSchema = {
  type: 'object',
  properties: {
    info: { $ref: '#/$defs/info' },
  },
  $defs: {
    info: {
      type: 'object',
      properties: { title: { type: 'string' } },
    },
  },
}

const files = await buildSchema(schema, 'Document')
// → [{ filename: 'document.ts', content: '...' }, { filename: 'info.ts', content: '...' }, ...]
```

Each entry in `files` is a `GeneratedFile`:

```ts
type GeneratedFile = {
  filename: string
  content: string
}
```

Write them to disk however you like.

---

## API

### `buildSchema(rootSchema, rootTypeName, …options)`

Every option after the first two is **positional** — pass them in this order:

| # | Parameter | Type | Default | Description |
|--:|:---|:---|:---|:---|
| 1 | `rootSchema` | `JSONSchema` | — | The root schema to traverse. `$ref` and `$dynamicRef` are resolved recursively. |
| 2 | `rootTypeName` | `string` | — | Name used for the root type (e.g. `"Document"`). Must be a TypeScript identifier: it is emitted verbatim as `export type <name>` and, lowercased, becomes the output filename, so a name derived from an untrusted document is refused rather than written outside your output directory. `@amritk/helpers`' `deriveRootTypeName` always produces one. |
| 3 | `extensions` | `SchemaExtensions` | — | Map of definition name → extra optional properties to merge in before generation. |
| 4 | `typesOnly` | `boolean` | — | Only emit `.ts` type definitions — skip parser functions and runtime helpers. |
| 5 | `logWarnings` | `boolean` | — | Generated parsers emit a `console.warn` for every input key not declared in the schema's properties. |
| 6 | `strict` | `boolean` | — | Generated parsers throw on type/shape mismatches (wrong type, missing required property, enum/pattern/min/max violations) instead of coercing invalid input to default values. |
| 7 | `helpersMode` | `'package' \| 'embedded'` | `'package'` | `'package'` imports runtime helpers from `@amritk/helpers`; `'embedded'` emits them alongside the output so it is self-contained. |
| 8 | `helpersImportPrefix` | `string` | `'./'` | Prefix the generated files use when importing embedded helpers. |
| 9 | `readonly` | `boolean` | `false` | Emit every property, array, and record in the type definitions as `readonly`. |
| 10 | `stripUnknown` | `boolean` | `false` | Build each result from the declared properties only, dropping undeclared input keys at every level (zod's `.strip()`). |
| 11 | `typeSuffix` | `string` | `''` | Suffix appended to every `$ref`-derived type name (`'Object'` turns `Contact` into `ContactObject`). The root type name is unaffected. |
| 12 | `importExt` | `'js' \| 'ts'` | `'js'` | Extension emitted on relative import specifiers. `'js'` is the NodeNext form for output you compile; `'ts'` emits the literal on-disk paths so the sources run unbuilt. |
| 13 | `caseInsensitive` | `boolean` | `false` | Normalize a mis-cased string to the exact casing of an enum/const member it matches case-insensitively. Coerce mode only. |
| 14 | `schemas` | `Record<string, unknown>` | — | Documents you have **already loaded**, keyed by the absolute URI a `$ref` names them by. See below. |

Returns: `Promise<GeneratedFile[]>`.

#### Referencing another document

A `$ref` to a URI is resolvable once you hand over the document behind it — pass
it as the 14th argument:

```typescript
const files = await buildSchema(
  { $ref: 'https://example.com/user.json' },
  'Document',
  undefined, false, false, true, 'embedded', './', false, false, '', 'js', false,
  { 'https://example.com/user.json': userSchema },
)
```

Each registered document becomes a resource of the generated document: its `$id`,
its `$anchor`s and `$dynamicAnchor`s and its own embedded resources all resolve, a
`$ref` from one registered document into another resolves, and each definition
reached gets a file, a type and a parser like any other. A document with no `$id`
resolves its relative `$ref`s against the URI you registered it under; one whose
`$id` disagrees answers to both.

Nothing is fetched — you cannot pass a URL, only a document — so generation stays
a pure function of its inputs. Loading is yours to do, or
[`@amritk/resolve-refs`](../resolve-refs)'. Registering more than the schema uses
costs nothing: only the documents actually reached are emitted. A `$ref` to a URI
nobody registered still stops the build, with a message naming the ref.

> [!NOTE]
> `importExt` defaults to `'js'` here, whereas the [`mjst` CLI](../cli) defaults it to
> `'ts'`. The example above therefore emits `./info.js` specifiers; pass `'ts'` for
> output meant to run without a build step.

---

## Options

<!-- config-table-start -->
<table>
<thead>
<tr>
<th>Property</th>
<th>Type</th>
<th align="center">Default</th>
</tr>
</thead>
<tbody>
<tr>
<td>🏷️ <code>typesOnly</code></td>
<td><code>boolean</code></td>
<td align="center"><code>false</code></td>
</tr>
<tr>
<td colspan="3">Generate only TypeScript type definitions without parser functions. Runtime helper files (validators, isObject) are also omitted since they are only needed for parsers.</td>
</tr>
<tr>
<td>⚠️ <code>logWarnings</code></td>
<td><code>boolean</code></td>
<td align="center"><code>false</code></td>
</tr>
<tr>
<td colspan="3">Emit a console.warn in the generated parsers for every input key that is not declared in the schema's properties. Useful for detecting schema drift or unexpected data shapes at runtime.</td>
</tr>
<tr>
<td>🚫 <code>strict</code></td>
<td><code>boolean</code></td>
<td align="center"><code>false</code></td>
</tr>
<tr>
<td colspan="3">Generate parsers that throw on type/shape mismatches (wrong type, missing required property, enum/pattern/min/max violations) instead of coercing invalid input to default values. When a schema sets additionalProperties: false, undeclared keys throw too; otherwise they are still allowed.</td>
</tr>
<tr>
<td>🧹 <code>stripUnknown</code></td>
<td><code>boolean</code></td>
<td align="center"><code>false</code></td>
</tr>
<tr>
<td colspan="3">Build each parser's result from the schema's declared properties only, silently dropping undeclared input keys at every nesting level (zod's .strip()). Extras are never a validation error, so this composes with strict (which still throws on wrong types and missing required properties) and yields to additionalProperties: false, which rejects rather than strips in strict mode.</td>
</tr>
<tr>
<td>🔡 <code>caseInsensitive</code></td>
<td><code>boolean</code></td>
<td align="center"><code>false</code></td>
</tr>
<tr>
<td colspan="3">Normalize a mis-cased string to the exact casing of a declared enum/const member it matches case-insensitively (e.g. hElLo → hello) instead of coercing to the default. Coerce mode only — strict parsers still reject a casing mismatch. Correctly-cased input keeps the exact-match fast path, so the hot path is unaffected.</td>
</tr>
</tbody>
</table>
<!-- config-table-end -->

The generator handles:

- `$ref` and `$dynamicRef` resolution, including JSON Schema 2020-12 `$dynamicAnchor` and a recursive root (`$ref: "#"`)
- Discriminated and non-discriminated unions (`oneOf` / `anyOf`)
- Enums and `const` values
- Nested objects, arrays, records, and tuples (`prefixItems`, and the draft-07 array form of `items`)
- Multi-type schemas (`type: ["string", "null"]`) and the OpenAPI 3.0 `nullable: true` spelling
- Composition alongside a declared shape — `allOf` members and sibling unions are intersected into the type, not dropped
- Pattern-based default values

### Strict-mode validation coverage

A `strict` parser throws on any document the schema rejects, and its accept /
reject decision is held against [Ajv](https://ajv.js.org) (2020-12) by a set of
differential fuzz suites. The whole Draft 2020-12 assertion vocabulary is
enforced:

| family | keywords |
|:--|:--|
| types | `type` (single and array form), `enum`, `const` (compared structurally) |
| numbers | `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf` |
| strings | `minLength`, `maxLength` (counted in Unicode **code points**), `pattern` |
| arrays | `items`, `prefixItems`, `additionalItems`, `minItems`, `maxItems`, `uniqueItems`, `contains`, `minContains`, `maxContains` |
| objects | `properties`, `required`, `patternProperties`, `additionalProperties`, `propertyNames`, `minProperties`, `maxProperties`, `dependentRequired`, `dependentSchemas` |
| composition | `allOf`, `anyOf`, `oneOf`, `not`, `if` / `then` / `else`, `$ref` (with its 2020-12 siblings), boolean schemas |
| annotations | `unevaluatedProperties`, `unevaluatedItems` — including the keys and indices an `allOf` member, a `$ref` target, a matching `anyOf` / `oneOf` branch, an `if` / `then` / `else` arm, or a triggered `dependentSchemas` entry evaluated |

Constraints bind their own family, with or without a declared `type`:
`{ minimum: 5 }` rejects `4` and accepts `"anything"`, exactly as JSON Schema
(and Ajv) specify.

Three deliberate departures:

- **`format` is an annotation**, not an assertion — matching Ajv's own default
  (`ajv-formats` is opt-in there). Use
  [`@amritk/runtime-validators`](../runtime-validators), whose `formats` option
  asserts them.
- **`multipleOf` compares within a magnitude-scaled tolerance** for a fractional
  divisor, rather than Ajv's exact `x / m` integer test, so `0.3` satisfies
  `multipleOf: 0.1` here and fails there. IEEE-754 makes the exact test reject
  values every author intends as valid. An integer divisor takes the exact `%`
  path, which needs no tolerance. Both branches are emitted from
  `@amritk/helpers/multiple-of-check`, which mirrors the runtime interpreter's
  own check — so parsers, validators, and the interpreter cannot disagree about
  a document.
- **A type-less schema that declares `properties` still requires an object.**
  Ajv accepts `"a string"` against `{ properties: { a: {} } }`; a parser has to
  return the type it declares, and the declared type is an object.

If a strict parser cannot enforce something — a `$ref` cycle it would have to
inline because the build emits a single file, a subschema using a keyword it
cannot prove — generation **fails with an error naming the keyword** rather than
emitting a parser that quietly accepts what the schema forbids. Coercing
(non-strict) parsers are documented to repair rather than reject, so they ignore
the rejecting keywords by design.

### Conformance, measured

The coverage above is not a claim — it is checked against the corpus every
validator in every language is judged on.
`src/generators/json-schema-conformance.test.ts` generates a strict parser for
each schema in the official
[JSON Schema Test Suite](https://github.com/json-schema-org/JSON-Schema-Test-Suite)
(the required Draft 2020-12 tests — 1281 cases), links the emitted files in
memory, and runs the suite's instances through the real generated code:

**1240 / 1281 cases pass (96.8%).**

A case passes only if the parser throws exactly when the spec says invalid *and*
returns an accepted document unchanged — strict mode does not coerce, so a parser
that quietly rewrites a valid document fails here too.

The suite's `remotes/` documents and the 2020-12 dialect metaschema are supplied
through the `schemas` option, which is how the suite intends a generator that does
no I/O to answer the retrieval step. Everything else — applying the base URIs,
walking anchors across documents, emitting a parser per definition and an import
graph that links — the generator still has to do.

Of the 41 that do not, **18** are the `ignores a non-object` cases that follow
from the third departure above, and **12** are a keyword strict mode will not
approximate (a cyclic `$ref` with siblings, a cyclic `unevaluatedProperties`) —
those cost a build error naming the cause, never a wrong verdict. The rest: **8**
`$dynamicRef`s whose binding depends on the evaluation path (a generator emits one
function per definition, shared by every path that reaches it), **2** embedded
resources whose definitions reduce to one filename, and one `$vocabulary` case.

Every one is listed in
`src/generators/json-schema-conformance-expected-failures.test-utils.ts` with the
reason, and the test fails if a case moves in *either* direction — a regression
breaks the build, and so does a case that starts passing without its entry being
removed. The corpus is vendored under
[`fixtures/json-schema-test-suite`](../../fixtures/json-schema-test-suite); none
of it is published.

---

## Benchmarks

Generated parsers are plain, straight-line TypeScript — no schema walking and no
generic dispatch at runtime, because the schema was already spent at build time.
Each parser reads the exact keys it declares, coerces or asserts them inline, and
returns a fresh typed object, so on valid input it runs several times faster than
libraries that interpret a schema (or a schema-shaped object graph) on every
call. The `bench/` suite replicates the `parseSafe` (assert + strip undeclared
keys) and `parseStrict` (assert + reject undeclared keys) halves of
[`moltar/typescript-runtime-type-benchmarks`](https://github.com/moltar/typescript-runtime-type-benchmarks)
against the other *pure* parsers — the ones that return a new typed value rather
than mutating in place — [zod](https://zod.dev) and
[TypeBox](https://github.com/sinclairzx81/typebox). Measured on Bun 1.4 (Linux
x64), parsing valid input at steady state:

| case | mode | mjst (generated) | zod | typebox |
|:--|:--|--:|--:|--:|
| user (4 fields) | parseSafe | **~18M** ops/s | ~3.7M ops/s | ~1.6M ops/s |
| order (nested + array) | parseSafe | **~6.9M** ops/s | ~0.71M ops/s | ~0.24M ops/s |
| user (4 fields) | parseStrict | **~14M** ops/s | ~2.3M ops/s | ~2.04M ops/s |
| order (nested + array) | parseStrict | **~7M** ops/s | ~0.43M ops/s | ~0.36M ops/s |

The upstream `assert` case (seven scalar roots plus a nested object) runs faster
still — ~51M ops/s strict, ~127M safe — but at that size the numbers swing enough
run-to-run that the ratio, not the absolute, is the honest signal: mjst lands
~5–29× ahead of zod across every case above.

The trade is a one-shot **prepare** cost that only mjst pays — generating the
parser source — which measures **~0.2–0.8 ms** per schema here (zod and TypeBox
author or interpret their parsers with no separate build step, so there is
nothing to time). That is trivially amortized: you generate once at build time
and run the emitted code forever.

Every library is checked for agreement — same stripped/rejected output, same
throws on bad input — before it is timed, and each is timed in its own isolated
process over a pool of distinct inputs, reporting the median of many trials, so
the optimiser can't hoist the work away. Micro-benchmark figures vary by machine
and runtime — reproduce with:

```bash
bun run bench
```

---

## Related packages

- [`@amritk/mjst`](../cli) — CLI wrapping this generator
- [`@amritk/generate-validators`](../generate-validators) — predicate-style validators (sister package)
- [`@amritk/generate-markdown`](../generate-markdown) — markdown documentation generator
- [`@amritk/helpers`](../helpers) — shared schema-traversal utilities

---

## License

[MIT](../../LICENSE)
