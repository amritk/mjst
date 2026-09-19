import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

/**
 * One mode under comparison, and the two samples that exercise its fast and slow
 * paths. `good` is a document the mode is happy with; `bad` is one it has to do
 * its characteristic work on — report, coerce, repair or throw.
 */
export type ModeCase = {
  readonly id: ModeId
  readonly label: string
  /** The exported function this mode is measured through. */
  readonly entry: string
  readonly good: unknown
  readonly bad: unknown
}

export const MODE_IDS = ['guard', 'validate', 'coerce', 'repair', 'parse', 'parseStrict'] as const
export type ModeId = (typeof MODE_IDS)[number]

const UUID = '00000000-0000-4000-8000-000000000000'

/**
 * A realistic nested document: flat scalars, a nested object, and an array of
 * objects. Deliberately the shape the other benches in this repo use, so a
 * number here can be read next to one there.
 */
export const SCHEMA: JSONSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1 },
    status: { type: 'string', enum: ['open', 'paid'], default: 'open' },
    total: { type: 'number', minimum: 0, default: 0 },
    customer: {
      type: 'object',
      properties: { name: { type: 'string', minLength: 1 }, age: { type: 'integer', minimum: 0, maximum: 130 } },
      required: ['name', 'age'],
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { sku: { type: 'string', minLength: 1 }, qty: { type: 'integer', minimum: 1 } },
        required: ['sku', 'qty'],
      },
    },
  },
  required: ['id', 'total', 'customer'],
}

export const TYPE_NAME = 'Order'

/** A document the schema already accepts. */
const CLEAN = {
  id: UUID,
  status: 'paid',
  total: 59.97,
  customer: { name: 'Ada', age: 36 },
  items: [
    { sku: 'A-1', qty: 2 },
    { sku: 'B-2', qty: 1 },
  ],
}

/** The same document with every number written as a string, as a text format carries it. */
const COERCIBLE = {
  id: UUID,
  status: 'paid',
  total: '59.97',
  customer: { name: 'Ada', age: '36' },
  items: [
    { sku: 'A-1', qty: '2' },
    { sku: 'B-2', qty: '1' },
  ],
}

/** A document that is wrong in ways no coercion fixes. */
const BROKEN = {
  id: '',
  total: -1,
  customer: { name: '', age: 999 },
  items: [{ sku: '', qty: 0 }],
}

export const MODE_CASES: readonly ModeCase[] = [
  { id: 'guard', label: 'guard (isX)', entry: `is${TYPE_NAME}`, good: CLEAN, bad: BROKEN },
  { id: 'validate', label: 'validate (validateX)', entry: `validate${TYPE_NAME}`, good: CLEAN, bad: BROKEN },
  { id: 'coerce', label: 'coerce (coerceX)', entry: `coerce${TYPE_NAME}`, good: CLEAN, bad: COERCIBLE },
  { id: 'repair', label: 'repair (repairX)', entry: `repair${TYPE_NAME}`, good: CLEAN, bad: BROKEN },
  { id: 'parse', label: 'parse (parseX)', entry: `parse${TYPE_NAME}`, good: CLEAN, bad: BROKEN },
  { id: 'parseStrict', label: 'parseStrict (parseX)', entry: `parse${TYPE_NAME}`, good: CLEAN, bad: CLEAN },
]
