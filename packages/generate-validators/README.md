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

### `buildValidatorSchema(rootSchema, rootTypeName, typeSuffix?, schemas?, unknownKeys?)`

| Parameter | Type | Default | Description |
|:---|:---|:---|:---|
| `rootSchema` | `JSONSchema` | — | The root schema to traverse. `$ref` and `$dynamicRef` are resolved recursively. Draft-07 schemas are upgraded to 2020-12 automatically. |
| `rootTypeName` | `string` | — | Name used for the root type (e.g. `"Document"`). |
| `typeSuffix` | `string` | `''` | Suffix appended to every `$ref`-derived type name (`'Object'` turns `Contact` into `ContactObject`). The root type name is unaffected. |
| `schemas` | `Record<string, unknown>` | — | Documents you have **already loaded**, keyed by the absolute URI a `$ref` names them by. See below. |
| `unknownKeys` | `'count-keys' \| 'count-enumerable'` | `'count-keys'` | How the fast paths prove a closed object (`additionalProperties: false`) has no undeclared key: `Object.keys(obj).length` (fastest on Bun) or a `for…in` count (fastest on Node). See [Choosing how keys are counted](#choosing-how-keys-are-counted). |

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
spelling of a schema whose 2020-12 spelling generates is accepted too. One
difference worth knowing: the check is a single sweep, so its error is reported at
the object or array — the shape Ajv reports too — where the interpreter names the
individual key or index. The verdict is identical either way.

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
`typeof` checks, every nested object loaded once into a local, plus a key count
when an object is closed with `additionalProperties: false` — and `return true`s
straight away, only calling a separate error-collecting function when something
is actually wrong.
Keeping the hot function tiny lets the JIT optimise it aggressively, so a
valid-input check beats every other library measured on JavaScriptCore — the
build-time transformer typia included — while still emitting full JSON-Pointer
errors for invalid input, and emitting the validator stays far cheaper than
compiling a schema at startup. On V8 that lead is not universal: TypeBox's
compiled checker wins the `assert-loose` shape outright and draws level on
`assert-strict`, which is why both engines get a table rather than one standing
in for the other.

Both were measured together on one machine (Linux x64, a 4-vCPU cloud box, Bun
1.4.0 and Node 26.8.1 — the same machine and runtimes as every table in this
repo). Each cell is the median of three separate runs of the whole suite. Treat
the absolutes as a property of that box: within one sitting a cell repeats to
within a few percent, but the same suite measured again hours later moved by
~60% across every case at once, so the ratios are the durable part and a
remembered number is not a baseline.

**Bun 1.4.0 / JavaScriptCore**, validating valid input at steady state:

| schema | mjst (generated) | typia (transformed) | ajv (compiled) | typebox (compiled) | zod |
|:--|--:|--:|--:|--:|--:|
| small (4 fields) | **~59M** ops/s | ~6.7M ops/s | ~11M ops/s | ~8.9M ops/s | ~2.4M ops/s |
| order (nested + array) | **~10M** ops/s | ~2.6M ops/s | ~4.1M ops/s | ~3.6M ops/s | ~0.50M ops/s |
| assert-loose | **~190M** ops/s | ~170M ops/s | ~46M ops/s | ~80M ops/s | ~3.6M ops/s |
| assert-strict | **~171M** ops/s | ~58M ops/s | ~23M ops/s | ~45M ops/s | ~1.4M ops/s |

**Node 26.8.1 / V8**, the same cases. typia is absent because its checks come
from a compile-time transform delivered as a Bun preload, so the Node run cannot
build one at all:

| schema | mjst (generated) | ajv (compiled) | typebox (compiled) | zod |
|:--|--:|--:|--:|--:|
| small (4 fields) | **~56M** ops/s | ~7.0M ops/s | ~6.6M ops/s | ~2.2M ops/s |
| order (nested + array) | **~8.9M** ops/s | ~2.8M ops/s | ~2.9M ops/s | ~0.48M ops/s |
| assert-loose | ~90M ops/s | ~71M ops/s | **~138M** ops/s | ~6.0M ops/s |
| assert-strict | ~37M ops/s | ~25M ops/s | **~37M** ops/s | ~3.6M ops/s |

Read the two together. On the object schemas — the shapes an application
actually validates — the generated validator leads on both engines, by 5–9× over
the next-fastest on Bun and 2.4–8× on Node. On the moltar shapes it leads
everything on JavaScriptCore and loses the loose one to TypeBox on V8 (~138M
against ~90M), with `assert-strict` a coin toss. Those two cases are seven
scalar roots and a nested object: near-trivial work where the engine's own
inlining decides the winner, not the validator's design.

The `assert-loose` / `assert-strict` rows use the same *shape* as
[`moltar/typescript-runtime-type-benchmarks`](https://github.com/moltar/typescript-runtime-type-benchmarks)
(seven scalar roots plus a nested object): on JavaScriptCore the boolean guard
keeps mjst ahead of typia on both, by ~12% on `assert-loose` — close enough that
the two trade the lead run-to-run — and by ~3× on `assert-strict` (with
`additionalProperties: false`), where mjst counts keys once and typia does not.
On V8 the same two rows go the other way against TypeBox, as the tables above
show. (typia and TypeBox still win the *invalid* path on both engines, where
they bail on the first error rather than collecting a full error list.)

They are **not** that project's numbers and they do not belong next to its
leaderboard: the shape is shared, the harness is not, and the harness is worth
an order of magnitude. See
[Against the moltar harness](#against-the-moltar-harness) for the same functions
measured under benny, the way the leaderboard measures them.

Preparing a validator costs ~0.2–0.7 ms for mjst codegen and ~0.03–0.23 ms for a
TypeBox `TypeCompiler` compile, versus ~10–13 ms for an Ajv compile on Bun and
~5–6.5 ms on Node — Ajv's compile is the one prepare cost that halves on V8.
Every library agrees on every verdict; parity is asserted before timing.

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
bun run bench        # Bun / JavaScriptCore
bun run bench:node   # Node / V8 (builds the package first, then runs it under node)
```

### Against the moltar harness

The table above is this package's own harness (`bench/measure.ts`): the
validator is called directly over a pool of 32 distinct inputs, its verdict is
folded into an escaping sink so nothing can be optimised away, and the median of
21 timed trials is reported.

The public leaderboard measures differently. Every operation there goes through
[benny](https://github.com/caderek/benny) (benchmark.js) into moltar's
`Benchmark` class, so the timed work is a call inside benchmark.js's compiled
loop, then a second call through a class property, around a fixture that is one
shared frozen module-level constant whose verdict `run()` throws away. That
harness has a floor, and near the top of the range the floor is what gets
measured.

`bun run bench:moltar` runs exactly that harness over the same functions, always
alongside a **no-op** control — a "validator" that checks nothing, which is the
fastest number the harness can physically produce. One run on this machine
(Linux x64, Bun 1.4.0 / Node 26.8.1, valid input):

| harness | runtime | `assert-loose` | `assert-strict` |
|:--|:--|--:|--:|
| this package (`measure.ts`) | Bun | ~190M ops/s | ~171M ops/s |
| this package (`measure.ts`) | Node | ~90M ops/s | ~37M ops/s |
| benny, moltar's `Benchmark` | Bun | ~90M ops/s | ~76M ops/s |
| benny, moltar's `Benchmark` | Node | ~80M ops/s | ~34M ops/s |
| *no-op control, benny* | *Node* | *~91M ops/s* | *~96M ops/s* |
| *no-op control, benny* | *Bun* | *~508M ops/s (±46%)* | *~449M ops/s (±48%)* |

Read three things out of that. First, on Node the `assert-loose` figure sits
within 12% of a validator that does nothing, so under that harness it is not a
validator measurement at all: above that floor a faster validator cannot show
up as a faster number, and the published leaderboard runs on CI hardware slower
than this box, where the floor sits lower still. Second, the harness reorders
the field: under benny on Node this validator leads TypeBox (~80M against
~54M), the reverse of what `measure.ts` reports for the same two functions on
the same engine, because benny's floor compresses the top of the range. Third,
moltar's fixture is `Object.freeze({ … })`: under Bun 1.3 that collapsed the Bun
`assert-strict` cell to ~2.4M, and Bun 1.4.0 has closed that cliff — see
[Frozen inputs](#frozen-inputs).

The harness makes no difference to correctness and every difference to the
number, so quote the two separately or not at all. Both are reproducible here:

```bash
bun run bench          # this package's harness
bun run bench:moltar   # benny, under the leaderboard's conditions
```

### Frozen inputs

Closing an object with `additionalProperties: false` means proving no
undeclared key is present, and every library answers that by enumerating keys:
mjst's guard counts them (`Object.keys(obj).length === n` by default, exact
because each declared property is required and already proven present — see
[Choosing how keys are counted](#choosing-how-keys-are-counted) for the
`for...in` alternative), Ajv and Zod sweep with `for...in`, TypeBox runs its own
sweep. On V8 that costs the same whatever the input looks like.

On JavaScriptCore under Bun 1.3 it did not. Making an object non-extensible —
`Object.freeze`, `Object.seal` or a bare `Object.preventExtensions` — turned off
the engine's cached own-keys fast path, and *every* form of key enumeration
fell back to a generic walk: `Object.keys`, `Object.getOwnPropertyNames`,
`Reflect.ownKeys` and `for...in` alike. Property reads were untouched (a frozen
object read at full speed), so the whole cost landed on the extra-key sweep, and
therefore on strict schemas only. Bun 1.4.0 no longer shows the cliff — frozen
and mutable input run at the same speed for every library. Frozen inputs are
ordinary — a config object frozen at startup, a shared fixture, a module-level
constant — so `bun run bench` keeps carrying `small (4 fields, frozen)` and
`assert-strict (frozen)` cases to keep it measured. One run of each on this
machine (Linux x64), valid input, on both Bun versions:

| `assert-strict` | Bun 1.4.0 mutable | Bun 1.4.0 frozen | Bun 1.3.11 mutable | Bun 1.3.11 frozen |
|:--|--:|--:|--:|--:|
| mjst (generated) | ~63M ops/s | ~67M ops/s | ~82M ops/s | ~1.5M ops/s |
| typia (transformed) | ~34M ops/s | ~48M ops/s | ~37M ops/s | ~1.5M ops/s |
| typebox (compiled) | ~29M ops/s | ~26M ops/s | ~27M ops/s | ~1.4M ops/s |
| ajv (compiled) | ~13M ops/s | ~13M ops/s | ~12M ops/s | ~1.2M ops/s |
| zod | ~0.99M ops/s | ~1.0M ops/s | ~0.91M ops/s | ~0.47M ops/s |

It was an engine-level cliff, not an mjst one: on Bun 1.3 every compiled or
generated strict validator lands within a hair of the same number, because they
are all paying the same engine slow path. The generated code keeps the key count
anyway. Every alternative was measured (on Bun 1.3.11) and every one is worse
overall. `Object.values(obj)` and `Object.keys({ ...obj })` sidestep the cliff,
but on the ordinary mutable path they cost 28–37× under JSC and 2–7× under V8.
Branching on `Object.isExtensible(obj)` first keeps the mutable path
recognisable, at ~4× under JSC — and makes V8 slower in *both* directions (~2×
mutable, ~7× frozen), where there was no cliff to fix in the first place.
Trading a large, portable regression for a smaller win on one engine is not a
good deal, so the sweep stays as it is — and Bun 1.4 has since closed the cliff
on its own.

If it matters for your workload on an older Bun: validate before freezing (the
verdict is the same either way — `src/generators/frozen-input.test.ts` pins
that), or run on Bun ≥ 1.4 or a V8 runtime, where the cliff does not exist.

### Choosing how keys are counted

The count itself can be spelled two ways, and the two trade places between the
engines. `unknownKeys` — the last argument of `buildValidatorSchema`, the
`--unknown-keys` flag of the CLI, the same option on `@amritk/generate-parsers` —
picks one at generation time:

- **`'count-keys'`** (default) — `Object.keys(obj).length === n`. Builds a keys
  array per call, which V8 scalar-replaces when only the length is read.
- **`'count-enumerable'`** — `let c = 0; for (const k in obj) c++`. Allocates
  nothing, and on V8 is answered straight from the shape's enum cache. On
  JavaScriptCore a `for...in` over a non-extensible object is the slow path
  described above, and even on a mutable one it trails `Object.keys`.

Measured under the moltar harness (benny, the frozen fixture, each case alone in
its own process — `bun run bench:moltar:leaderboard` prints one row per strategy
on every runtime it finds), Linux x64. The Node 22 column is the earlier
measurement this option was introduced against; the Node 26 column is the same
harness on the current runtime:

| case | `unknownKeys` | Bun 1.4 | Node 22 | Node 26 |
|:--|:--|--:|--:|--:|
| `assertStrict` (`isX`) | `count-keys` | ~441M ops/s (the harness floor — the call is eliminated) | ~19M ops/s | ~31M ops/s |
| `assertStrict` (`isX`) | `count-enumerable` | ~42M ops/s | ~22M ops/s | ~30M ops/s |
| `parseStrict` (`@amritk/generate-parsers`) | `count-keys` | ~359M ops/s (the harness floor again) | ~14M ops/s | ~29M ops/s |
| `parseStrict` (`@amritk/generate-parsers`) | `count-enumerable` | ~22M ops/s | ~14M ops/s | ~26M ops/s |

The default is `count-keys` because it is never the slower form on Bun and,
with the nested shape check spelled out on the parse fast path, lets
JavaScriptCore eliminate the strict parse as well. The Node case has changed
with the engine: on Node 22 `count-enumerable` was level or slightly ahead,
which is where the advice to flip it for Node-only builds came from, but on
Node 26 the default is ahead in both rows. Keep it unless you are pinned to an
older V8 and have measured your own shapes. The choice is made once, when the
code is generated: nothing in the emitted file detects its runtime. (On Bun 1.3, where a frozen object puts
`Object.keys` on the same slow path as `for...in`, both strategies sit at ~2M
ops/s under this fixture and the default is a wash.)

The two strategies also read different key sets — `Object.keys` sees own keys,
`for...in` sees enumerable ones, inherited included — which no value parsed from
JSON can tell apart. The `for...in` count agrees with the cold path exactly, so
`isX` and `validateX` answer alike on a crafted prototype; the own-key count can
accept an *inherited* extra that `validateXErrors` would report, and `isX` under
it declines an inherited declared key that `validateX` accepts through its cold
path. Neither strategy ever accepts a value the interpreter rejects on JSON data.

---

## Related packages

- [`@amritk/generate-parsers`](../generate-parsers) — type definitions plus parsers that coerce input
- [`@amritk/mjst`](../cli) — CLI wrapper around the generators
- [`@amritk/helpers`](../helpers) — shared schema-traversal utilities

---

## License

[MIT](../../LICENSE)
