import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { z } from 'zod'

/**
 * Each benchmark case carries three equivalent encodings of the same contract —
 * a JSON Schema (the input mjst and Ajv both consume), a hand-written Zod schema
 * (Zod has no schema-compilation step, so it is authored directly), and a
 * valid / invalid sample pair used for the throughput and parity checks.
 */
export type BenchCase = {
  name: string
  typeName: string
  schema: JSONSchema
  zod: z.ZodType
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

export const BENCH_CASES: readonly BenchCase[] = [
  {
    name: 'small (4 fields)',
    typeName: 'User',
    schema: smallSchema,
    zod: smallZod,
    valid: { id: '00000000-0000-4000-8000-000000000000', name: 'Ada', age: 36, active: true },
    invalid: { id: 'not-a-uuid', name: '', age: -1 },
  },
  {
    name: 'order (nested + array)',
    typeName: 'Order',
    schema: orderSchema,
    zod: orderZod,
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
