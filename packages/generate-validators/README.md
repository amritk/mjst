<div align="center">

# @amritk/generate-validators

**Programmatic API for generating predicate-style TypeScript validators from JSON Schemas.**

![status](https://img.shields.io/badge/status-pre--alpha-ef4444?style=flat-square)&nbsp;
![version](https://img.shields.io/npm/v/@amritk/generate-validators?style=flat-square&logo=npm&logoColor=white&label=version&color=6366f1)&nbsp;
![license](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)&nbsp;
![JSON Schema](https://img.shields.io/badge/JSON%20Schema-2020--12-f97316?style=flat-square)&nbsp;
![node](https://img.shields.io/badge/node-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white)&nbsp;
![vibe coded](https://img.shields.io/badge/vibe-coded-a855f7?style=flat-square)

</div>

---

## Overview

`@amritk/generate-validators` produces lightweight runtime **validators** from a JSON Schema. Where [`@amritk/generate-parsers`](../generate-parsers) coerces and parses unknown input into a typed value, this package emits cheaper predicate-style functions that simply tell you whether a value matches a schema (and where it doesn't).

Each generated file exports:

- A TypeScript `type` definition for the schema
- A `validateFoo(input: unknown, _path?: string): ValidationResult` function
- An `isFoo(input: unknown): input is Foo` boolean type guard — a single flat
  predicate (no error array, no cold-path call) reaching the same verdict as
  `validateFoo`, for the common "is this valid?" question

A shared `validation-result.ts` template and an `index.ts` barrel are emitted alongside the generated files.

---

## Installation

```bash
npm install @amritk/generate-validators
# or
pnpm add @amritk/generate-validators
# or
yarn add @amritk/generate-validators
# or
bun add @amritk/generate-validators
```

---

## Usage

```ts
import { buildValidatorSchema } from '@amritk/generate-validators'
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
      required: ['title'],
    },
  },
}

const files = await buildValidatorSchema(schema, 'Document')
// → [{ filename: 'document.ts', content: '...' }, { filename: 'info.ts', ... }, { filename: 'validation-result.ts', ... }, { filename: 'index.ts', ... }]
```

Write the resulting files to disk and import the validators where you need them:

```ts
import { validateDocument } from './generated'

const result = validateDocument(input)
if (!result.valid) {
  console.error(result.errors)
}
```

---

## API

### `buildValidatorSchema(rootSchema, rootTypeName, typeSuffix?, schemas?)`

| Parameter | Type | Default | Description |
|:---|:---|:---|:---|
| `rootSchema` | `JSONSchema` | — | The root schema to traverse. `$ref` and `$dynamicRef` are resolved recursively. Draft-07 schemas are upgraded to 2020-12 automatically. |
| `rootTypeName` | `string` | — | Name used for the root type (e.g. `"Document"`). |
| `typeSuffix` | `string` | `''` | Suffix appended to every `$ref`-derived type name (`'Object'` turns `Contact` into `ContactObject`). The root type name is unaffected. |
| `schemas` | `Record<string, unknown>` | — | Documents you have **already loaded**, keyed by the absolute URI a `$ref` names them by. See below. |

Returns: `Promise<GeneratedFile[]>` where `GeneratedFile = { filename: string; content: string }`.

#### Names it will not emit

Both name arguments are used as written — the root type name verbatim, the suffix
appended to every `$ref`-derived name — so both can name something the output
cannot say. Generation stops with the name and the reason rather than writing a
file that fails in your build: a name that is not a plain TypeScript identifier
(`'my-doc'`, `''`, `'123'`, `'class'`); a definition that would claim the
`validation-result.ts` or `index.ts` filename; and one whose type name comes out
as `ValidationResult` or `ValidationError`, which every generated file already
imports. A type suffix that moves such a name clear — `ValidationErrorObject` — is
no collision, and non-ASCII identifiers are fine, because TypeScript takes them.

#### Referencing another document

A `$ref` to a URI is resolvable once you hand over the document behind it:

```typescript
const files = await buildValidatorSchema({ $ref: 'https://example.com/user.json' }, 'Document', '', {
  'https://example.com/user.json': userSchema,
})
```

Each registered document becomes a resource of the generated document: its `$id`,
its `$anchor`s and `$dynamicAnchor`s and its own embedded resources all resolve, a
`$ref` from one registered document into another resolves, and each definition
reached gets a file and a type like any other. A document with no `$id` resolves
its relative `$ref`s against the URI you registered it under; one whose `$id`
disagrees answers to both.

Nothing is fetched — you cannot pass a URL, only a document — so generation stays
a pure function of its inputs. Loading is yours to do, or
[`@amritk/resolve-refs`](../resolve-refs)'. Registering more than the schema uses
costs nothing: only the documents actually reached are emitted. A `$ref` to a URI
nobody registered still stops the build, with a message naming the ref.

---

## Semantics

Generated validators track the `@amritk/runtime-validators` interpreter. Array
items are validated in full — an item's type, `$ref`, nested `properties` /
`required`, and scalar constraints (`minLength`, `minimum`, …) are all enforced,
recursing to any depth — and the boolean guard (`isX`) reaches the identical
verdict. Validating array item *contents* costs throughput proportional to the
per-item work (a bare `string[]` is free; a closed object with several fields is
meaningfully slower), which is why array-heavy schemas validate more slowly than
scalar/object ones.

**A schema needs no `type` for its keywords to be enforced.** `{ minLength: 2 }`,
`{ required: ['a'] }` and `{ uniqueItems: true }` each emit their check behind a
runtime test for the family they constrain, so they reject a bad string / object /
array and *ignore* every other kind of value — which is what JSON Schema means by
a type-less constraint, and what the interpreter does. One consequence is worth
knowing: object keywords no longer imply `type: 'object'`, so `validateX` accepts
`42` against `{ properties: { … } }`, while the emitted TypeScript type still
describes the object case (as `FromSchema` does in `@amritk/runtime-validators`).
The verdict is the contract and it matches the interpreter exactly; for that one
shape `isX` is a weaker type guard than the type it names. Declare a `type` — as
almost every real schema does — and the guard is exact again.

**Values JSON cannot hold get an answer, not a surprise.** A generated validator
is a plain function applied to whatever you hand it, so it can meet things
`JSON.parse` never produces — and it answers each the way the interpreter and Ajv
do. A key present with an `undefined` value is a value to judge, not an absent
one, wherever a sweep found the key (`patternProperties`, a schema-form
`additionalProperties`, `unevaluatedProperties`). A hole in a sparse array is an
element that has to answer for itself, in the item loops, the tuple positions,
`contains` and `unevaluatedItems` alike. `NaN` equals itself under `const`,
`enum` and `uniqueItems`, so `[NaN, NaN]` is a duplicate pair while `[NaN, null]`
is not. And a self-referential object reaches a verdict — the structural
comparison stops at 512 levels — where it used to throw a `RangeError` out of a
function whose signature promises a `ValidationResult`.

**`format` emits no check.** JSON Schema treats `format` as an annotation, and so
does this generator: `{ type: 'string', format: 'uuid' }` produces the `typeof`
check and nothing more. That matches the interpreter's default, but *not* the
interpreter run with `{ formats: 'all' }` — as `@amritk/lint` and
`createApi({ formats })` do — so a generated validator accepts strings those
reject.

**`unevaluatedProperties` / `unevaluatedItems` are generated**, not refused. Each
emits a flat expression computing what the interpreter computes as annotations: per
key or index, a boolean that is true when some keyword evaluated it. Keywords that
must succeed for the value to be valid at all (`allOf` members, a `$ref` target, a
satisfied `contains`) count unconditionally — sound, because the test is one
conjunct of a validator that also asserts them — while conditional applicators
(`anyOf` / `oneOf` branches, `if` / `then` / `else`, `dependentSchemas`) carry their
condition, hoisted out of the per-key loop. Four shapes still refuse, each named as
a shape rather than as a keyword: coverage running through a `$dynamicRef`, an
unresolvable or cyclic `$ref` at the same instance location, a walk deeper than
eight applicators, and a node under an *inert* `additionalItems` — one with no
array `items` to be the tail of, or with a `prefixItems` that took the positions
out from under it. The draft-07 tail itself is validated, so the draft-07
spelling of a schema whose 2020-12 spelling generates is accepted too.

One edge worth calling out: **`NaN` fails a constrained number but satisfies an
unconstrained one.** Every bound is emitted as the negated *pass* condition
(`!(x >= minimum)`, not `x < minimum`), and `NaN` compares `false` against every
operator, so it fails the bound — and `multipleOf` rejects it on both branches of
the shared `@amritk/helpers/multiple-of-check`. A bare `{ type: 'number' }` with
no constraint still accepts it, as Ajv does. This matches
`@amritk/runtime-validators` exactly, and the match is pinned value-by-value in
`interpreter-parity.test.ts` rather than asserted here. `NaN` never appears in
parsed JSON, so this only matters for values built in memory.

### Conformance, measured

The semantics above are measured, not asserted.
`src/generators/conformance.test.ts` generates a validator for each schema in the
official [JSON Schema Test Suite](https://github.com/json-schema-org/JSON-Schema-Test-Suite)
(the required Draft 2020-12 tests — 1281 cases), compiles and links the emitted
files in memory, and runs the suite's instances through the real generated code:

**1274 / 1281 cases pass (99.5%).**

The suite's `remotes/` documents and the 2020-12 dialect metaschema are supplied
through the `schemas` option, which is how the suite intends a validator that does
no I/O to answer the retrieval step. Everything else — applying the base URIs,
walking anchors across documents, naming and emitting a file per definition — the
generator still has to do.

Of the 7 that do not pass: four `$dynamicRef`s whose binding depends on the
evaluation path (a generator emits one function per definition, shared by every
path that reaches it, so it cannot bind per path), two definitions in different
embedded resources that reduce to one filename, and `$vocabulary`. Nothing on the
list is a keyword that silently returns the wrong answer.

Every case is named in
`src/generators/conformance-expected-failures.test-utils.ts` with its reason, and
the test fails if a case moves in *either* direction — a regression breaks the
build, and so does a case that starts passing without its entry being removed.

If you need one of those refusals to be an answer instead, validate with
[`@amritk/runtime-validators`](../runtime-validators), which passes the same corpus
in full (**1281/1281**), at the cost of interpreting the schema at runtime.
The corpus is vendored under
[`fixtures/json-schema-test-suite`](../../fixtures/json-schema-test-suite); none
of it is published.

---

## Benchmarks

Generated validators are straight-line, monomorphic TypeScript with no generic
dispatch. The exported `validateX` is split into a hot and a cold half: on the
happy path it runs a single allocation-free boolean guard — a pure `&&` chain of
`typeof` checks (plus an `Object.keys().length` count when an object is closed
with `additionalProperties: false`) — and `return true`s straight away, only
calling a separate error-collecting function when something is actually wrong.
Keeping the hot function tiny lets V8 optimise it aggressively, so a valid-input
check beats every other library measured — including the build-time transformer
typia — while still emitting full JSON-Pointer errors for invalid input, and
emitting the validator stays far cheaper than compiling a schema at startup.
Measured on Bun 1.3 (Linux x64), validating valid input at steady state:

| schema | mjst (generated) | typia (transformed) | ajv (compiled) | typebox (compiled) | zod |
|:--|--:|--:|--:|--:|--:|
| small (4 fields) | **~49M** ops/s | ~6.4M ops/s | ~11M ops/s | ~5.7M ops/s | ~2.4M ops/s |
| order (nested + array) | **~11M** ops/s | ~2.5M ops/s | ~4M ops/s | ~2.4M ops/s | ~0.52M ops/s |
| assert-loose | **~177M** ops/s | ~162M ops/s | ~46M ops/s | ~70M ops/s | ~3.9M ops/s |
| assert-strict | **~164M** ops/s | ~146M ops/s | ~20M ops/s | ~44M ops/s | ~1.5M ops/s |

The `assert-loose` / `assert-strict` rows are the exact shape used by
[`moltar/typescript-runtime-type-benchmarks`](https://github.com/moltar/typescript-runtime-type-benchmarks)
(seven scalar roots plus a nested object): the boolean guard keeps mjst ahead of
typia on both, by ~10% on `assert-loose` and ~12% on `assert-strict` (with
`additionalProperties: false`) — close enough that the two can trade the lead
run-to-run. (typia and TypeBox still win the *invalid* path, where they bail on
the first error rather than collecting a full error list.)

Preparing a validator costs ~0.3–0.7 ms for mjst codegen and ~0.04–0.3 ms for a
TypeBox `TypeCompiler` compile, versus ~7–11 ms for an Ajv compile. Every library
agrees on every verdict; parity is asserted before timing.

One caveat on the first two rows: their schemas declare `format` (`uuid`,
`email`), and Ajv, typia, zod, and TypeBox all check it, while mjst's generated
validators treat it as an annotation (see [Semantics](#semantics)). So on `small`
and `order`, mjst is doing slightly less work than the columns beside it — the
parity samples fail other constraints too, which is why the verdicts still agree.
The `assert-loose` / `assert-strict` rows carry no `format` and are the
constraint-for-constraint comparison. Each library is
timed in an isolated process over a pool of distinct inputs, reporting the median
of many trials — so the optimiser can't hoist or eliminate the work and the
numbers stay reproducible. Micro-benchmark figures vary by machine and runtime —
reproduce with:

```bash
bun run bench
```

---

## Related packages

- [`@amritk/generate-parsers`](../generate-parsers) — type definitions plus parsers that coerce input
- [`@amritk/mjst`](../cli) — CLI wrapper around the generators
- [`@amritk/helpers`](../helpers) — shared schema-traversal utilities

---

## License

[MIT](../../LICENSE)
