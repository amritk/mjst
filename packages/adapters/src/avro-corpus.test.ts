import { validate } from '@amritk/runtime-validators'
import { describe, expect, it } from 'vitest'

import { type AvroEncoding, avroToJsonSchema } from './avro-to-json-schema'

/**
 * Invariants the Avro adapter must hold for *every* schema it accepts, checked
 * over a corpus rather than case by case.
 *
 * Three separate defects reached review as the same symptom — an emitted
 * `default` that fails the very subschema it annotates — each time through a
 * different route: a union left untagged, a union tagged one level too shallow,
 * and a name resolved in the wrong namespace. Individual regression tests pin
 * each route; this pins the property they all violated, so the next route is
 * caught by construction rather than by someone thinking to look.
 */

type Case = { readonly name: string; readonly avro: unknown }

const CORPUS: readonly Case[] = [
  {
    name: 'primitives',
    avro: {
      type: 'record',
      name: 'P',
      fields: [
        { name: 'a', type: 'null' },
        { name: 'b', type: 'boolean' },
        { name: 'c', type: 'int' },
        { name: 'd', type: 'long' },
        { name: 'e', type: 'float' },
        { name: 'f', type: 'double' },
        { name: 'g', type: 'bytes' },
        { name: 'h', type: 'string' },
      ],
    },
  },
  {
    name: 'nullable-with-default',
    avro: { type: 'record', name: 'N', fields: [{ name: 'v', type: ['null', 'string'], default: null }] },
  },
  {
    name: 'union-default-first-branch',
    avro: { type: 'record', name: 'U', fields: [{ name: 'v', type: ['string', 'null'], default: 'hi' }] },
  },
  {
    name: 'union-object-form-null',
    avro: { type: 'record', name: 'ON', fields: [{ name: 'v', type: [{ type: 'null' }, 'string'], default: null }] },
  },
  {
    name: 'same-json-type-union',
    avro: { type: 'record', name: 'FD', fields: [{ name: 'v', type: ['float', 'double'] }] },
  },
  {
    name: 'record-default',
    avro: {
      type: 'record',
      name: 'RD',
      fields: [
        {
          name: 'v',
          type: { type: 'record', name: 'Cfg', fields: [{ name: 'host', type: ['string', 'null'] }] },
          default: { host: 'localhost' },
        },
      ],
    },
  },
  {
    name: 'array-of-union-default',
    avro: {
      type: 'record',
      name: 'AU',
      fields: [{ name: 'v', type: { type: 'array', items: ['string', 'null'] }, default: ['hi'] }],
    },
  },
  {
    name: 'map-of-union-default',
    avro: {
      type: 'record',
      name: 'MU',
      fields: [{ name: 'v', type: { type: 'map', values: ['string', 'null'] }, default: { k: 'hi' } }],
    },
  },
  {
    name: 'nested-namespaces',
    avro: {
      type: 'record',
      name: 'Root',
      namespace: 'outer',
      fields: [
        {
          name: 'sub',
          type: {
            type: 'record',
            name: 'Sub',
            namespace: 'inner',
            fields: [{ name: 'u', type: [{ type: 'enum', name: 'E', symbols: ['A', 'B'] }, 'null'] }],
          },
          default: { u: 'A' },
        },
      ],
    },
  },
  {
    name: 'sibling-fixed-reference',
    avro: {
      type: 'record',
      name: 'Root',
      namespace: 'outer',
      fields: [
        {
          name: 'sub',
          type: {
            type: 'record',
            name: 'Sub',
            namespace: 'inner',
            fields: [
              { name: 'f0', type: { type: 'fixed', name: 'F', size: 2 } },
              { name: 'blob', type: 'F' },
            ],
          },
          default: { f0: 'ab', blob: 'ab' },
        },
      ],
    },
  },
  {
    name: 'enum-with-default',
    avro: {
      type: 'record',
      name: 'ED',
      fields: [{ name: 'v', type: { type: 'enum', name: 'S', symbols: ['X', 'Y'], default: 'X' }, default: 'Y' }],
    },
  },
  {
    name: 'recursive',
    avro: { type: 'record', name: 'Node', fields: [{ name: 'next', type: ['null', 'Node'], default: null }] },
  },
  {
    name: 'deep-nesting',
    avro: {
      type: 'record',
      name: 'Deep',
      fields: [
        {
          name: 'v',
          type: {
            type: 'array',
            items: {
              type: 'map',
              values: { type: 'record', name: 'Leaf', fields: [{ name: 'q', type: ['int', 'null'] }] },
            },
          },
          default: [{ k: { q: 1 } }],
        },
      ],
    },
  },
  {
    name: 'logical-types',
    avro: {
      type: 'record',
      name: 'L',
      fields: [
        { name: 'id', type: { type: 'string', logicalType: 'uuid' } },
        { name: 'at', type: { type: 'long', logicalType: 'timestamp-millis' } },
        { name: 'amt', type: { type: 'bytes', logicalType: 'decimal', precision: 4, scale: 2 } },
      ],
    },
  },
  {
    name: 'byte-default-dropped',
    avro: { type: 'record', name: 'B', fields: [{ name: 'v', type: ['bytes', 'null'], default: 'ÿþ' }] },
  },
  {
    name: 'proto-named-field',
    avro: {
      type: 'record',
      name: 'PP',
      fields: [
        { name: '__proto__', type: 'string' },
        { name: 'constructor', type: 'int' },
      ],
    },
  },
]

const ENCODINGS: readonly AvroEncoding[] = ['json', 'avro-json']

type SchemaObject = Record<string, unknown>

const isObject = (value: unknown): value is SchemaObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Every subschema in the document, so a whole-output property can be asserted. */
const everySubschema = function* (node: unknown): Generator<SchemaObject> {
  if (Array.isArray(node)) {
    for (const item of node) yield* everySubschema(item)
    return
  }
  if (!isObject(node)) return
  yield node
  for (const value of Object.values(node)) yield* everySubschema(value)
}

describe('avro-corpus', () => {
  it.each(
    CORPUS.flatMap((entry) => ENCODINGS.map((encoding) => ({ ...entry, encoding }))),
  )('holds its invariants for $name under $encoding', ({ avro, encoding }) => {
    const document = avroToJsonSchema(avro, { encoding }) as SchemaObject
    const defs = (document['$defs'] ?? {}) as Record<string, unknown>

    for (const subschema of everySubschema(document)) {
      // Every $ref resolves inside the document. A broken pointer silently
      // referenced a definition that was never written.
      const ref = subschema['$ref']
      if (typeof ref === 'string') {
        expect(ref.startsWith('#/$defs/'), `unresolvable $ref ${ref}`).toBe(true)
        expect(Object.hasOwn(defs, ref.slice('#/$defs/'.length)), `dangling $ref ${ref}`).toBe(true)
      }

      // A `type` array's members must be unique, or the metaschema rejects it.
      const type = subschema['type']
      if (Array.isArray(type)) {
        expect(new Set(type).size, `duplicate type members in ${JSON.stringify(type)}`).toBe(type.length)
      }

      // A closed object may not require a property it does not define: that
      // combination rejects every possible document.
      const required = subschema['required']
      if (Array.isArray(required) && subschema['additionalProperties'] === false) {
        const properties = (subschema['properties'] ?? {}) as Record<string, unknown>
        for (const key of required) {
          expect(Object.hasOwn(properties, String(key)), `requires undefined property ${String(key)}`).toBe(true)
        }
      }

      // The one that matters most: a `default` must satisfy the schema it sits
      // on. `default` is not annotation-only here — generate-parsers coerces
      // with it, so a wrong one reaches real output.
      if (Object.hasOwn(subschema, 'default')) {
        const { default: value, ...rest } = subschema
        const result = validate({ ...rest, $defs: defs } as never)(value)
        expect(result, `default ${JSON.stringify(value)} fails its own subschema`).toBe(true)
      }
    }
  })
})
