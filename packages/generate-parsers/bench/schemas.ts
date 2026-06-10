import { type TSchema, Type } from '@sinclair/typebox'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { z } from 'zod'

/**
 * The "parseSafe" half of `moltar/typescript-runtime-type-benchmarks`: take
 * input that conforms to the contract but carries undeclared keys, assert its
 * types, and return a *clean* typed object with the extras stripped — zod's
 * `.strip()`. Every library under comparison does this as a **pure** operation
 * (it returns a new value and leaves the input untouched), which is what lets a
 * single reused input pool measure them fairly; mutate-in-place strippers (ajv's
 * `removeAdditional`, typia's `assertPrune`) are deliberately excluded and live
 * in the validators benchmark instead.
 *
 * Each case carries four encodings of one contract — a JSON Schema (what mjst's
 * parser codegen and the others derive from), a hand-written Zod schema, and a
 * hand-written TypeBox schema — plus an `input` (valid data with undeclared keys
 * sprinkled in), the `expected` stripped result every library must agree on, and
 * an `invalid` sample whose wrong types every parser must reject by throwing.
 *
 * The schemas are intentionally *open* (no `additionalProperties: false`): under
 * parseSafe the extras are stripped, not rejected, so mjst is built in
 * `strict + stripUnknown` mode — strict asserts the types (throwing on a
 * mismatch, like the others) while stripUnknown removes the undeclared keys.
 */
export type ParseCase = {
  name: string
  typeName: string
  schema: JSONSchema
  zod: z.ZodType
  typebox: TSchema
  /** Valid data carrying undeclared keys at the root and in nested objects. */
  input: unknown
  /** The clean, stripped object every parser must produce from `input`. */
  expected: unknown
  /** Wrong-typed data every parser must reject by throwing. */
  invalid: unknown
}

const UUID = '00000000-0000-4000-8000-000000000000'

/** small — four flat scalar fields, one optional. */
const smallExpected = { id: UUID, name: 'Ada', age: 36, active: true }
const smallSchema: JSONSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string', minLength: 1, maxLength: 80 },
    age: { type: 'integer', minimum: 0, maximum: 130 },
    active: { type: 'boolean' },
  },
  required: ['id', 'name', 'age'],
}
const smallZod = z.object({
  id: z.string(),
  name: z.string().min(1).max(80),
  age: z.number().int().min(0).max(130),
  active: z.boolean().optional(),
})
const smallTypebox = Type.Object({
  id: Type.String(),
  name: Type.String({ minLength: 1, maxLength: 80 }),
  age: Type.Integer({ minimum: 0, maximum: 130 }),
  active: Type.Optional(Type.Boolean()),
})

/**
 * order — a realistic nested order. Undeclared keys are added at the root and in
 * the two nested objects (`customer`, `shipTo`); the line items stay clean so the
 * case measures nested-object stripping without depending on how each library
 * treats objects nested inside arrays.
 */
const orderExpected = {
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
const orderItem: JSONSchema = {
  type: 'object',
  properties: {
    sku: { type: 'string', minLength: 1 },
    qty: { type: 'integer', minimum: 1 },
    price: { type: 'number', minimum: 0 },
  },
  required: ['sku', 'qty', 'price'],
}
const orderSchema: JSONSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    status: { type: 'string', enum: ['pending', 'paid', 'shipped', 'cancelled'] },
    total: { type: 'number', minimum: 0 },
    customer: {
      type: 'object',
      properties: { name: { type: 'string', minLength: 1 }, email: { type: 'string' } },
      required: ['name', 'email'],
    },
    shipTo: {
      type: 'object',
      properties: {
        street: { type: 'string', minLength: 1 },
        city: { type: 'string', minLength: 1 },
        zip: { type: 'string', pattern: '^[0-9]{5}$' },
      },
      required: ['street', 'city', 'zip'],
    },
    items: { type: 'array', minItems: 1, items: orderItem },
  },
  required: ['id', 'status', 'total', 'customer', 'items'],
}
const orderZod = z.object({
  id: z.string(),
  status: z.enum(['pending', 'paid', 'shipped', 'cancelled']),
  total: z.number().min(0),
  customer: z.object({ name: z.string().min(1), email: z.string() }),
  shipTo: z
    .object({ street: z.string().min(1), city: z.string().min(1), zip: z.string().regex(/^[0-9]{5}$/) })
    .optional(),
  items: z.array(z.object({ sku: z.string().min(1), qty: z.number().int().min(1), price: z.number().min(0) })).min(1),
})
const orderTypebox = Type.Object({
  id: Type.String(),
  status: Type.Union([
    Type.Literal('pending'),
    Type.Literal('paid'),
    Type.Literal('shipped'),
    Type.Literal('cancelled'),
  ]),
  total: Type.Number({ minimum: 0 }),
  customer: Type.Object({ name: Type.String({ minLength: 1 }), email: Type.String() }),
  shipTo: Type.Optional(
    Type.Object({
      street: Type.String({ minLength: 1 }),
      city: Type.String({ minLength: 1 }),
      zip: Type.String({ pattern: '^[0-9]{5}$' }),
    }),
  ),
  items: Type.Array(
    Type.Object({
      sku: Type.String({ minLength: 1 }),
      qty: Type.Integer({ minimum: 1 }),
      price: Type.Number({ minimum: 0 }),
    }),
    { minItems: 1 },
  ),
})

/**
 * assert — the exact moltar shape: seven scalar roots plus one nested object.
 * The ~1.1k-char `longString` keeps the payload string-heavy so the comparison
 * reflects realistic data rather than a degenerate all-shape check.
 */
const LONG_STRING = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(20)
const assertExpected = {
  number: 1,
  negNumber: -1,
  maxNumber: Number.MAX_VALUE,
  string: 'string',
  longString: LONG_STRING,
  boolean: true,
  deeplyNested: { foo: 'bar', num: 1, bool: false },
}
const assertSchema: JSONSchema = {
  type: 'object',
  properties: {
    number: { type: 'number' },
    negNumber: { type: 'number' },
    maxNumber: { type: 'number' },
    string: { type: 'string' },
    longString: { type: 'string' },
    boolean: { type: 'boolean' },
    deeplyNested: {
      type: 'object',
      properties: { foo: { type: 'string' }, num: { type: 'number' }, bool: { type: 'boolean' } },
      required: ['foo', 'num', 'bool'],
    },
  },
  required: ['number', 'negNumber', 'maxNumber', 'string', 'longString', 'boolean', 'deeplyNested'],
}
const assertZod = z.object({
  number: z.number(),
  negNumber: z.number(),
  maxNumber: z.number(),
  string: z.string(),
  longString: z.string(),
  boolean: z.boolean(),
  deeplyNested: z.object({ foo: z.string(), num: z.number(), bool: z.boolean() }),
})
const assertTypebox = Type.Object({
  number: Type.Number(),
  negNumber: Type.Number(),
  maxNumber: Type.Number(),
  string: Type.String(),
  longString: Type.String(),
  boolean: Type.Boolean(),
  deeplyNested: Type.Object({ foo: Type.String(), num: Type.Number(), bool: Type.Boolean() }),
})

export const PARSE_CASES: readonly ParseCase[] = [
  {
    name: 'small (4 fields)',
    typeName: 'User',
    schema: smallSchema,
    zod: smallZod,
    typebox: smallTypebox,
    input: { ...smallExpected, extra: 'drop me', another: 42 },
    expected: smallExpected,
    invalid: { id: UUID, name: 'Ada', age: 'thirty-six' },
  },
  {
    name: 'order (nested + array)',
    typeName: 'Order',
    schema: orderSchema,
    zod: orderZod,
    typebox: orderTypebox,
    input: {
      ...orderExpected,
      extra: true,
      customer: { ...orderExpected.customer, vip: true },
      shipTo: { ...orderExpected.shipTo, country: 'US' },
    },
    expected: orderExpected,
    invalid: { ...orderExpected, total: 'free' },
  },
  {
    name: 'assert (moltar parseSafe)',
    typeName: 'Assert',
    schema: assertSchema,
    zod: assertZod,
    typebox: assertTypebox,
    input: {
      ...assertExpected,
      extra: true,
      deeplyNested: { ...assertExpected.deeplyNested, extra: 'drop me' },
    },
    expected: assertExpected,
    invalid: { ...assertExpected, number: 'foo' },
  },
]
