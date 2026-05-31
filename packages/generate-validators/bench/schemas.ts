import { FormatRegistry, type TSchema, Type } from '@sinclair/typebox'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { z } from 'zod'

/**
 * TypeBox does not validate `format` unless a checker is registered, so we wire
 * up the two formats these schemas use. This keeps the comparison fair — every
 * library does the same uuid/email work — and is what a TypeBox user shipping
 * these contracts would do anyway.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
FormatRegistry.Set('uuid', (value) => UUID_RE.test(value))
FormatRegistry.Set('email', (value) => EMAIL_RE.test(value))

/**
 * Each benchmark case carries four equivalent encodings of the same contract —
 * a JSON Schema (the input mjst and Ajv both consume), a hand-written Zod schema
 * and a hand-written TypeBox schema (neither has mjst's standalone codegen step;
 * Zod is authored directly while TypeBox is compiled at startup like Ajv), and a
 * valid / invalid sample pair used for the throughput and parity checks.
 */
export type BenchCase = {
  name: string
  typeName: string
  schema: JSONSchema
  zod: z.ZodType
  typebox: TSchema
  valid: unknown
  invalid: unknown
}

const smallSchema: JSONSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string', minLength: 1, maxLength: 80 },
    age: { type: 'integer', minimum: 0, maximum: 130 },
    active: { type: 'boolean' },
  },
  required: ['id', 'name', 'age'],
}

const smallZod = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(80),
  age: z.number().int().min(0).max(130),
  active: z.boolean().optional(),
})

const smallTypebox = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    name: Type.String({ minLength: 1, maxLength: 80 }),
    age: Type.Integer({ minimum: 0, maximum: 130 }),
    active: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
)

/** A realistic nested order: address sub-object, line-item array, enum status. */
const orderSchema: JSONSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: ['pending', 'paid', 'shipped', 'cancelled'] },
    total: { type: 'number', minimum: 0 },
    customer: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', minLength: 1 },
        email: { type: 'string', format: 'email' },
      },
      required: ['name', 'email'],
    },
    shipTo: {
      type: 'object',
      additionalProperties: false,
      properties: {
        street: { type: 'string', minLength: 1 },
        city: { type: 'string', minLength: 1 },
        zip: { type: 'string', pattern: '^[0-9]{5}$' },
      },
      required: ['street', 'city', 'zip'],
    },
    items: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sku: { type: 'string', minLength: 1 },
          qty: { type: 'integer', minimum: 1 },
          price: { type: 'number', minimum: 0 },
        },
        required: ['sku', 'qty', 'price'],
      },
    },
  },
  required: ['id', 'status', 'total', 'customer', 'items'],
}

const orderZod = z.object({
  id: z.string().uuid(),
  status: z.enum(['pending', 'paid', 'shipped', 'cancelled']),
  total: z.number().min(0),
  customer: z.object({
    name: z.string().min(1),
    email: z.string().email(),
  }),
  shipTo: z
    .object({
      street: z.string().min(1),
      city: z.string().min(1),
      zip: z.string().regex(/^[0-9]{5}$/),
    })
    .optional(),
  items: z
    .array(
      z.object({
        sku: z.string().min(1),
        qty: z.number().int().min(1),
        price: z.number().min(0),
      }),
    )
    .min(1),
})

const orderTypebox = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    status: Type.Union([
      Type.Literal('pending'),
      Type.Literal('paid'),
      Type.Literal('shipped'),
      Type.Literal('cancelled'),
    ]),
    total: Type.Number({ minimum: 0 }),
    customer: Type.Object(
      {
        name: Type.String({ minLength: 1 }),
        email: Type.String({ format: 'email' }),
      },
      { additionalProperties: false },
    ),
    shipTo: Type.Optional(
      Type.Object(
        {
          street: Type.String({ minLength: 1 }),
          city: Type.String({ minLength: 1 }),
          zip: Type.String({ pattern: '^[0-9]{5}$' }),
        },
        { additionalProperties: false },
      ),
    ),
    items: Type.Array(
      Type.Object(
        {
          sku: Type.String({ minLength: 1 }),
          qty: Type.Integer({ minimum: 1 }),
          price: Type.Number({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
  },
  { additionalProperties: false },
)

export const BENCH_CASES: readonly BenchCase[] = [
  {
    name: 'small (4 fields)',
    typeName: 'User',
    schema: smallSchema,
    zod: smallZod,
    typebox: smallTypebox,
    valid: { id: '00000000-0000-4000-8000-000000000000', name: 'Ada', age: 36, active: true },
    invalid: { id: 'not-a-uuid', name: '', age: -1 },
  },
  {
    name: 'order (nested + array)',
    typeName: 'Order',
    schema: orderSchema,
    zod: orderZod,
    typebox: orderTypebox,
    valid: {
      id: '00000000-0000-4000-8000-000000000000',
      status: 'paid',
      total: 59.97,
      customer: { name: 'Ada', email: 'ada@example.com' },
      shipTo: { street: '1 Main', city: 'Metropolis', zip: '12345' },
      items: [
        { sku: 'A-1', qty: 2, price: 9.99 },
        { sku: 'B-2', qty: 1, price: 40 },
      ],
    },
    invalid: {
      id: 'nope',
      status: 'unknown',
      total: -5,
      customer: { name: '', email: 'not-an-email' },
      items: [],
    },
  },
]
