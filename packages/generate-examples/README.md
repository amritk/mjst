<div align="center">

# @amritk/generate-examples

**Programmatic API for generating fast-check arbitraries and example values from JSON Schemas.**

![status](https://img.shields.io/badge/status-pre--alpha-ef4444?style=flat-square)&nbsp;
![version](https://img.shields.io/npm/v/@amritk/generate-examples?style=flat-square&logo=npm&logoColor=white&label=version&color=6366f1)&nbsp;
![license](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)&nbsp;
![JSON Schema](https://img.shields.io/badge/JSON%20Schema-2020--12-f97316?style=flat-square)&nbsp;
![node](https://img.shields.io/badge/node-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white)&nbsp;
![vibe coded](https://img.shields.io/badge/vibe-coded-a855f7?style=flat-square)

</div>

---

## Overview

`@amritk/generate-examples` turns a JSON Schema into **test data**. Where the
other mjst generators give you code that _consumes_ data at runtime (parsers,
validators, types), this one closes the loop by giving you data to _exercise_
that code with.

Each generated file exports:

- A TypeScript `type` definition for the schema
- A [`fast-check`](https://github.com/dubzzz/fast-check) arbitrary (`FooArbitrary`)
  that produces schema-valid values — ideal for property-based testing
- A concrete, self-contained example value (`fooExample`) — ideal for fixtures,
  seeds, and documentation

An `index.ts` barrel re-exports everything.

> [!NOTE]
> The generated arbitraries import `fast-check`, so consumers need it installed
> (`npm i -D fast-check`). An arbitrary whose schema uses a keyword no `fc.*`
> combinator captures on its own (`if`/`then`/`else`, `not`, exclusive `oneOf`,
> and the presence-gated object keywords) also imports `@amritk/runtime-validators`
> for a post-generation validating filter; files that need no such filter don't.
> The static `fooExample` values have no runtime dependencies.
>
> `@amritk/runtime-validators` is a `dependency` here rather than a peer, because
> this generator imports it itself. That resolves it for the generator, but *not*
> necessarily for the generated file — that file lands in **your** source tree, so
> under pnpm's strict layout or Yarn PnP it resolves from your project, not from
> this package's. If your schemas use any of those keywords, install it directly
> (`npm i @amritk/runtime-validators`). It cannot also be declared a peer: Bun
> rejects a workspace package listed as both, and `--frozen-lockfile` then fails
> for the whole repo.

---

## Installation

```bash
npm install @amritk/generate-examples
# or
pnpm add @amritk/generate-examples
# or
yarn add @amritk/generate-examples
# or
bun add @amritk/generate-examples
```

---

## Usage

```typescript
import { buildExampleSchema } from '@amritk/generate-examples'

const schema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    age: { type: 'integer', minimum: 0 },
  },
  required: ['id'],
} as const

const files = await buildExampleSchema(schema, 'User')
// → [{ filename: 'user.ts', content: '...' }, { filename: 'index.ts', content: '...' }]
```

The generated `user.ts` looks like:

```typescript
import * as fc from 'fast-check'

export type User = { id: string; age?: number }

export const UserArbitrary: fc.Arbitrary<User> = fc.record(
  { "id": fc.uuid(), "age": fc.integer({ min: 0 }) },
  { requiredKeys: ["id"] },
)

export const userExample: User = { "id": "00000000-0000-0000-0000-000000000000", "age": 0 }
```

Use the arbitrary in a property test:

```typescript
import { test, fc } from '@fast-check/vitest'
import { UserArbitrary } from './generated'
import { parseUser } from './parsers'

test.prop([UserArbitrary])('parseUser round-trips any valid User', (user) => {
  expect(parseUser(user)).toEqual(user)
})
```

…or grab the static example as a fixture:

```typescript
import { userExample } from './generated'

const res = await fetch('/users', { method: 'POST', body: JSON.stringify(userExample) })
```

---

## Lower-level API

| Export | Description |
|:---|:---|
| `buildExampleSchema(schema, rootName, suffix?)` | Walks the `$ref` graph and returns a `GeneratedFile[]` (one file per schema + an `index.ts`). |
| `generateArbitrary(schema, typeName, suffix?)` | Returns the `export const …Arbitrary` source for a single schema node. |
| `generateExampleConst(schema, typeName, rootSchema?)` | Returns the `export const …Example` source for a single schema node. |
| `deriveExample(schema, rootSchema?)` | Returns a concrete, schema-valid JavaScript value (no code-generation). |
| `serializeValue(value)` | Serializes a derived value to a TypeScript source expression (handles `Date`/`bigint`). |

---

## Supported keywords

`type` — including multi-type unions like `['string', 'null']` —
(string/number/integer/boolean/null/array/object), `properties`,
`required`, `items`, `minItems`/`maxItems`, `uniqueItems`,
`minLength`/`maxLength`, `pattern`, `format`, `minimum`/`maximum`,
`exclusiveMinimum`/`exclusiveMaximum`, `multipleOf`, `enum` (filtered by sibling
constraints), `const`, `minProperties`/`maxProperties`, `patternProperties`,
`propertyNames`, `dependentRequired`, `dependentSchemas`, `contains`,
`oneOf`/`anyOf`, `if`/`then`/`else`, `not`, `$ref`, and the `x-mjst` extension
(`Date`, `bigint`). `if`/`then`/`else`, `not`, and `oneOf` exclusivity are
enforced by validating generated candidates against the schema and
retrying/rejecting. Unsupported constructs degrade to `fc.anything()` in
arbitraries and `null` in static examples.

Static examples cover every `format` `@amritk/runtime-validators` knows how to
check: `email`, `idn-email`, `date`, `date-time`, `time`, `duration`, `uuid`,
`uri`, `iri`, `uri-reference`, `iri-reference`, `uri-template`, `json-pointer`,
`relative-json-pointer`, `hostname`, `idn-hostname`, `ipv4`, `ipv6`, `regex`,
plus OpenAPI's `url`. An unrecognized `format` falls back to `"string"`.

---

## Known limits

Every `fooExample` is validated against its own schema before it is written. When
the value does not satisfy the schema it is still emitted — so the module always
compiles — but the generator prints a `console.warn` naming the type. Reach for
`FooArbitrary` in those cases: the arbitrary carries a runtime validating filter
and stays correct where the static value cannot.

The value falls short for three reasons:

- **The schema has no instance.** `{ pattern: '^ab$', minLength: 5 }`,
  `uniqueItems` over booleans with `minItems: 3`, a `required` key that
  `additionalProperties: false` forbids, or a `oneOf` whose branches every value
  matches twice. Nothing correct exists to emit; the warning is pointing at the
  schema, not the generator.
- **The constraint is beyond the deriver.** `pattern` is sampled by a
  best-effort recursive-descent walk of the regex, so lookarounds and
  backreferences fall back to `"string"`; an unrecognized `format` does the same.
- **The bound is larger than any fixture should be.** A derived string, array, or
  object stops growing at 10,000 characters / elements / keys, so a document
  asking for `minLength: 50000000` yields a capped value and a warning rather than
  a 50 MB literal. `FooArbitrary` still honours the real bound.

Two more shapes worth knowing about, both of which keep the generated file
compiling rather than making it correct:

- A schema can require a key its **generated type never declares** — `required`
  naming something absent from `properties`, a `dependentRequired` /
  `dependentSchemas` dependency, or a `minProperties` filler on an object with no
  index signature. The example keeps the key (a fixture missing what its schema
  demands is broken data) and is emitted as `… as Foo`, since a bare object
  literal with an excess property fails to compile.
- An authored `default` or `examples[0]` is used **only when it satisfies its own
  schema**. A hint that does not (`{ type: 'string', default: 42 }` — common in
  documents whose field types changed after the hint was written) is ignored in
  favour of a structurally derived value, because the generated type follows the
  schema and would reject the hint outright. `const` is always honoured: the type
  is the const's own literal type, so the two cannot disagree.
- An **unsatisfiable range** (`minLength: 10, maxLength: 2`) collapses onto its
  upper bound in the arbitrary. Every bounded `fc.*` combinator asserts
  `min <= max` and throws at *import*, which would take down every other export in
  the file alongside it.

> [!TIP]
> The example for a `$ref` is inlined by value, so a definition graph with wide
> fan-out produces a correspondingly large literal. That cost is in the output
> size, not in generation time — each definition is derived once per document.

---

## License

[MIT](../../LICENSE)
