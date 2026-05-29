<div align="center">

# @amritk/generate-examples

**Programmatic API for generating fast-check arbitraries and example values from JSON Schemas.**

![status](https://img.shields.io/badge/status-pre--alpha-ef4444?style=flat-square)&nbsp;
![license](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)&nbsp;
![JSON Schema](https://img.shields.io/badge/JSON%20Schema-2020--12-f97316?style=flat-square)&nbsp;
![node](https://img.shields.io/badge/node-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white)

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
> (`npm i -D fast-check`). The static `fooExample` values have no runtime
> dependencies.

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

`type` (string/number/integer/boolean/null/array/object), `properties`,
`required`, `items`, `minItems`/`maxItems`, `uniqueItems`,
`minLength`/`maxLength`, `pattern`, `format` (`email`, `uuid`, `uri`/`url`,
`date`, `date-time`), `minimum`/`maximum`, `exclusiveMinimum`/`exclusiveMaximum`,
`multipleOf`, `enum`, `const`, `oneOf`/`anyOf`, `$ref`, and the `x-mjst`
extension (`Date`, `bigint`). Unsupported constructs degrade to `fc.anything()`
in arbitraries and `null` in static examples.

> [!TIP]
> A static example constrained only by `pattern` is not guaranteed to match the
> pattern — reach for the arbitrary when pattern fidelity matters.

---

## License

[MIT](../../LICENSE)
