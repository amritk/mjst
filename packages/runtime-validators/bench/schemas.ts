/**
 * Benchmark fixtures: schemas paired with valid and invalid sample data.
 *
 * The goal is to compare against Ajv on the cases that actually matter —
 * especially large/complex schemas — so we include a small schema (baseline
 * overhead), a wide schema (many primitive properties), and a deep schema
 * (nested objects + arrays of objects, the shape of a real API payload).
 */

export type BenchCase = {
  name: string
  schema: Record<string, unknown>
  valid: unknown
  invalid: unknown
}

/** A tiny schema — measures per-call fixed overhead more than real work. */
const smallSchema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    name: { type: 'string' },
    active: { type: 'boolean' },
  },
  required: ['id', 'name'],
  additionalProperties: false,
}

const smallValid = { id: 1, name: 'Ada', active: true }
const smallInvalid = { id: 'nope', active: true }

/**
 * A wide schema: 40 primitive properties with assorted constraints. This is the
 * "many fields" config-object case where per-property dispatch overhead shows.
 */
const wideProperties: Record<string, unknown> = {}
const wideValid: Record<string, unknown> = {}
const wideRequired: string[] = []
for (let i = 0; i < 40; i++) {
  const key = `field_${i}`
  if (i % 4 === 0) {
    wideProperties[key] = { type: 'string', minLength: 1, maxLength: 50 }
    wideValid[key] = `value-${i}`
  } else if (i % 4 === 1) {
    wideProperties[key] = { type: 'integer', minimum: 0, maximum: 1000 }
    wideValid[key] = i
  } else if (i % 4 === 2) {
    wideProperties[key] = { type: 'boolean' }
    wideValid[key] = i % 2 === 0
  } else {
    wideProperties[key] = { type: 'number', minimum: -100 }
    wideValid[key] = i * 1.5
  }
  if (i % 3 === 0) wideRequired.push(key)
}

const wideSchema = {
  type: 'object',
  properties: wideProperties,
  required: wideRequired,
  additionalProperties: false,
}

const wideInvalid = { ...wideValid, field_0: 123, field_5: 'not-a-number' }

/**
 * A deep schema: a realistic nested document with `$defs`, `$ref`s, arrays of
 * objects, enums, patterns, and formats. This is the headline "large schema"
 * comparison.
 */
const deepSchema = {
  $id: 'https://example.com/order',
  type: 'object',
  required: ['id', 'customer', 'items'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    createdAt: { type: 'string', format: 'date-time' },
    status: { enum: ['pending', 'paid', 'shipped', 'cancelled'] },
    customer: { $ref: '#/$defs/customer' },
    items: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/$defs/lineItem' },
    },
    tags: { type: 'array', items: { type: 'string' }, uniqueItems: true },
    metadata: {
      type: 'object',
      additionalProperties: { type: 'string' },
    },
  },
  $defs: {
    customer: {
      type: 'object',
      required: ['id', 'email'],
      additionalProperties: false,
      properties: {
        id: { type: 'integer', minimum: 1 },
        email: { type: 'string', format: 'email' },
        name: { type: 'string', minLength: 1, maxLength: 120 },
        address: { $ref: '#/$defs/address' },
        phone: { type: 'string', pattern: '^[0-9+\\-() ]{7,20}$' },
      },
    },
    address: {
      type: 'object',
      required: ['street', 'city', 'zip'],
      additionalProperties: false,
      properties: {
        street: { type: 'string', minLength: 1 },
        city: { type: 'string', minLength: 1 },
        zip: { type: 'string', pattern: '^[0-9]{5}$' },
        country: { type: 'string', minLength: 2, maxLength: 2 },
      },
    },
    lineItem: {
      type: 'object',
      required: ['sku', 'quantity', 'price'],
      additionalProperties: false,
      properties: {
        sku: { type: 'string', pattern: '^[A-Z0-9-]{4,16}$' },
        quantity: { type: 'integer', minimum: 1, maximum: 9999 },
        price: { type: 'number', exclusiveMinimum: 0 },
        discount: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
  },
}

const makeLineItem = (n: number) => ({
  sku: `SKU-${1000 + n}`,
  quantity: (n % 9) + 1,
  price: 9.99 + n,
  discount: (n % 5) / 10,
})

const deepValid = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  createdAt: '2024-01-01T12:00:00Z',
  status: 'paid',
  customer: {
    id: 42,
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    address: { street: '1 Analytical Way', city: 'London', zip: '12345', country: 'GB' },
    phone: '+44 207 123 4567',
  },
  items: Array.from({ length: 20 }, (_, n) => makeLineItem(n)),
  tags: ['priority', 'gift', 'fragile'],
  metadata: { source: 'web', campaign: 'spring' },
}

const deepInvalid = {
  id: 'not-a-uuid',
  status: 'unknown',
  customer: {
    id: 0,
    email: 'not-an-email',
    address: { street: '', city: 'London', zip: 'ABCDE' },
  },
  items: [{ sku: 'bad sku', quantity: 0, price: -5 }],
  tags: ['dup', 'dup'],
}

export const BENCH_CASES: readonly BenchCase[] = [
  { name: 'small', schema: smallSchema, valid: smallValid, invalid: smallInvalid },
  { name: 'wide (40 props)', schema: wideSchema, valid: wideValid, invalid: wideInvalid },
  { name: 'deep ($ref + arrays)', schema: deepSchema, valid: deepValid, invalid: deepInvalid },
]
