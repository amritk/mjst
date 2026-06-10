import { type TSchema, Type } from '@sinclair/typebox'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { z } from 'zod'

/**
 * Both parse halves of `moltar/typescript-runtime-type-benchmarks`, over this
 * repo's *pure* parsers (mjst, zod, typebox) — the ones that return a new typed
 * value rather than mutating the input. Mutate-in-place strippers (ajv's
 * `removeAdditional`, typia's `assertPrune`) are excluded and live in the
 * validators benchmark instead.
 *
 *   - **parseSafe** — assert the types and *strip* undeclared keys (zod's
 *     `.strip()`). The schema is open; mjst runs in `strict + stripUnknown`, zod
 *     uses `.object` (strips by default), TypeBox runs a `Clean + Assert` parse.
 *   - **parseStrict** — assert the types and *reject* undeclared keys (zod's
 *     `.strict()`). The schema closes every object with `additionalProperties:
 *     false`; mjst runs in plain `strict`, zod uses `.strictObject`, TypeBox runs
 *     an `Assert`-only parse. The timed input is clean (rejection is the failure
 *     path), and an extra-key sample is asserted to throw before timing.
 *
 * Each case carries three encodings of one contract (JSON Schema, Zod, TypeBox),
 * the `input` to parse, the `expected` result, and the samples every parser must
 * reject by throwing.
 */
export type ParseMode = 'safe' | 'strict'

export type ParseCase = {
  name: string
  mode: ParseMode
  typeName: string
  schema: JSONSchema
  zod: z.ZodType
  typebox: TSchema
  /** The value to parse on the timed happy path. */
  input: unknown
  /** The result every parser must produce from `input`. */
  expected: unknown
  /** Samples every parser must reject by throwing (wrong types, and — in strict mode — extra keys). */
  mustThrow: readonly unknown[]
}

/**
 * One contract, defined once and projected into both parse modes. `schema`,
 * `zod`, and `typebox` take a `strict` flag that closes every object level; the
 * `valid` / `withExtras` / `invalid` samples are shared.
 */
type Shape = {
  typeName: string
  schema: (strict: boolean) => JSONSchema
  zod: (strict: boolean) => z.ZodType
  typebox: (strict: boolean) => TSchema
  valid: unknown
  /** `valid` plus undeclared keys at the root and in nested objects. */
  withExtras: unknown
  /** A wrong-typed sample every parser must reject in either mode. */
  invalid: unknown
}

/** Closes an object JSON Schema with `additionalProperties: false` when strict. */
const obj = (properties: Record<string, JSONSchema>, required: string[], strict: boolean): JSONSchema => ({
  type: 'object',
  properties,
  required,
  ...(strict ? { additionalProperties: false } : {}),
})

const UUID = '00000000-0000-4000-8000-000000000000'

/** small — four flat scalar fields, one optional. */
const smallValid = { id: UUID, name: 'Ada', age: 36, active: true }
const small: Shape = {
  typeName: 'User',
  schema: (strict) =>
    obj(
      {
        id: { type: 'string' },
        name: { type: 'string', minLength: 1, maxLength: 80 },
        age: { type: 'integer', minimum: 0, maximum: 130 },
        active: { type: 'boolean' },
      },
      ['id', 'name', 'age'],
      strict,
    ),
  zod: (strict) => {
    const fields = {
      id: z.string(),
      name: z.string().min(1).max(80),
      age: z.number().int().min(0).max(130),
      active: z.boolean().optional(),
    }
    return strict ? z.strictObject(fields) : z.object(fields)
  },
  typebox: (strict) =>
    Type.Object(
      {
        id: Type.String(),
        name: Type.String({ minLength: 1, maxLength: 80 }),
        age: Type.Integer({ minimum: 0, maximum: 130 }),
        active: Type.Optional(Type.Boolean()),
      },
      strict ? { additionalProperties: false } : {},
    ),
  valid: smallValid,
  withExtras: { ...smallValid, extra: 'drop me', another: 42 },
  invalid: { id: UUID, name: 'Ada', age: 'thirty-six' },
}

/**
 * order — a realistic nested order. Undeclared keys are added at the root and in
 * the two nested objects (`customer`, `shipTo`); the line items stay clean so the
 * case measures nested-object handling without depending on how each library
 * treats objects nested inside arrays.
 */
const orderValid = {
  id: UUID,
  status: 'paid',
  total: 59.97,
  customer: { name: 'Ada', email: 'ada@example.com' },
  shipTo: { street: '1 Main', city: 'Metropolis', zip: '12345' },
  items: [
    { sku: 'A-1', qty: 2, price: 9.99 },
    { sku: 'B-2', qty: 1, price: 40 },
  ],
}
const order: Shape = {
  typeName: 'Order',
  schema: (strict) =>
    obj(
      {
        id: { type: 'string' },
        status: { type: 'string', enum: ['pending', 'paid', 'shipped', 'cancelled'] },
        total: { type: 'number', minimum: 0 },
        customer: obj({ name: { type: 'string', minLength: 1 }, email: { type: 'string' } }, ['name', 'email'], strict),
        shipTo: obj(
          {
            street: { type: 'string', minLength: 1 },
            city: { type: 'string', minLength: 1 },
            zip: { type: 'string', pattern: '^[0-9]{5}$' },
          },
          ['street', 'city', 'zip'],
          strict,
        ),
        items: {
          type: 'array',
          minItems: 1,
          items: obj(
            {
              sku: { type: 'string', minLength: 1 },
              qty: { type: 'integer', minimum: 1 },
              price: { type: 'number', minimum: 0 },
            },
            ['sku', 'qty', 'price'],
            strict,
          ),
        },
      },
      ['id', 'status', 'total', 'customer', 'items'],
      strict,
    ),
  zod: (strict) => {
    const o = strict ? z.strictObject : z.object
    return o({
      id: z.string(),
      status: z.enum(['pending', 'paid', 'shipped', 'cancelled']),
      total: z.number().min(0),
      customer: o({ name: z.string().min(1), email: z.string() }),
      shipTo: o({ street: z.string().min(1), city: z.string().min(1), zip: z.string().regex(/^[0-9]{5}$/) }).optional(),
      items: z.array(o({ sku: z.string().min(1), qty: z.number().int().min(1), price: z.number().min(0) })).min(1),
    })
  },
  typebox: (strict) => {
    const opts = strict ? { additionalProperties: false } : {}
    return Type.Object(
      {
        id: Type.String(),
        status: Type.Union([
          Type.Literal('pending'),
          Type.Literal('paid'),
          Type.Literal('shipped'),
          Type.Literal('cancelled'),
        ]),
        total: Type.Number({ minimum: 0 }),
        customer: Type.Object({ name: Type.String({ minLength: 1 }), email: Type.String() }, opts),
        shipTo: Type.Optional(
          Type.Object(
            {
              street: Type.String({ minLength: 1 }),
              city: Type.String({ minLength: 1 }),
              zip: Type.String({ pattern: '^[0-9]{5}$' }),
            },
            opts,
          ),
        ),
        items: Type.Array(
          Type.Object(
            {
              sku: Type.String({ minLength: 1 }),
              qty: Type.Integer({ minimum: 1 }),
              price: Type.Number({ minimum: 0 }),
            },
            opts,
          ),
          { minItems: 1 },
        ),
      },
      opts,
    )
  },
  valid: orderValid,
  withExtras: {
    ...orderValid,
    extra: true,
    customer: { ...orderValid.customer, vip: true },
    shipTo: { ...orderValid.shipTo, country: 'US' },
  },
  invalid: { ...orderValid, total: 'free' },
}

/**
 * assert — the exact moltar shape: seven scalar roots plus one nested object.
 * The ~1.1k-char `longString` keeps the payload string-heavy so the comparison
 * reflects realistic data rather than a degenerate all-shape check.
 */
const LONG_STRING = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(20)
const assertValid = {
  number: 1,
  negNumber: -1,
  maxNumber: Number.MAX_VALUE,
  string: 'string',
  longString: LONG_STRING,
  boolean: true,
  deeplyNested: { foo: 'bar', num: 1, bool: false },
}
const assert: Shape = {
  typeName: 'Assert',
  schema: (strict) =>
    obj(
      {
        number: { type: 'number' },
        negNumber: { type: 'number' },
        maxNumber: { type: 'number' },
        string: { type: 'string' },
        longString: { type: 'string' },
        boolean: { type: 'boolean' },
        deeplyNested: obj(
          { foo: { type: 'string' }, num: { type: 'number' }, bool: { type: 'boolean' } },
          ['foo', 'num', 'bool'],
          strict,
        ),
      },
      ['number', 'negNumber', 'maxNumber', 'string', 'longString', 'boolean', 'deeplyNested'],
      strict,
    ),
  zod: (strict) => {
    const o = strict ? z.strictObject : z.object
    return o({
      number: z.number(),
      negNumber: z.number(),
      maxNumber: z.number(),
      string: z.string(),
      longString: z.string(),
      boolean: z.boolean(),
      deeplyNested: o({ foo: z.string(), num: z.number(), bool: z.boolean() }),
    })
  },
  typebox: (strict) => {
    const opts = strict ? { additionalProperties: false } : {}
    return Type.Object(
      {
        number: Type.Number(),
        negNumber: Type.Number(),
        maxNumber: Type.Number(),
        string: Type.String(),
        longString: Type.String(),
        boolean: Type.Boolean(),
        deeplyNested: Type.Object({ foo: Type.String(), num: Type.Number(), bool: Type.Boolean() }, opts),
      },
      opts,
    )
  },
  valid: assertValid,
  withExtras: { ...assertValid, extra: true, deeplyNested: { ...assertValid.deeplyNested, extra: 'drop me' } },
  invalid: { ...assertValid, number: 'foo' },
}

const SHAPES: readonly Shape[] = [small, order, assert]

/** parseSafe: open schema, parse the with-extras input, expect the stripped value. */
const safeCase = (shape: Shape): ParseCase => ({
  name: `${shape.typeName} · safe`,
  mode: 'safe',
  typeName: shape.typeName,
  schema: shape.schema(false),
  zod: shape.zod(false),
  typebox: shape.typebox(false),
  input: shape.withExtras,
  expected: shape.valid,
  mustThrow: [shape.invalid],
})

/** parseStrict: closed schema, parse the clean input, and reject extras (and wrong types). */
const strictCase = (shape: Shape): ParseCase => ({
  name: `${shape.typeName} · strict`,
  mode: 'strict',
  typeName: shape.typeName,
  schema: shape.schema(true),
  zod: shape.zod(true),
  typebox: shape.typebox(true),
  input: shape.valid,
  expected: shape.valid,
  mustThrow: [shape.invalid, shape.withExtras],
})

export const PARSE_CASES: readonly ParseCase[] = [...SHAPES.map(safeCase), ...SHAPES.map(strictCase)]
