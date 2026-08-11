import { afterEach, describe, expect, it } from 'vitest'

import { validate } from './validate'

/**
 * Every JSON Schema keyword this interpreter reads, polluted onto
 * `Object.prototype` one at a time.
 *
 * Schemas and instances both arrive at runtime, and a bare `obj[key]` or
 * `'key' in obj` answers from the prototype chain — so a single polluted name
 * turned keywords on for schemas that never declared them, and turned
 * properties on for objects that never carried them. That was found and fixed
 * one keyword at a time across several reviews; enumerating the surface is what
 * stops the next one being found the same way.
 *
 * `Object.prototype` is polluted for the duration of one assertion and cleaned
 * up after each, so a failure here cannot leak into another test.
 */
const KEYWORDS = [
  'additionalProperties',
  'propertyNames',
  'unevaluatedProperties',
  'patternProperties',
  'properties',
  'required',
  'dependentRequired',
  'dependentSchemas',
  'dependencies',
  'items',
  'prefixItems',
  'contains',
  'unevaluatedItems',
  'not',
  'if',
  'then',
  'else',
  'allOf',
  'anyOf',
  'oneOf',
  'const',
  'enum',
  'type',
  'format',
  'pattern',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'minProperties',
  'maxProperties',
  'multipleOf',
  'uniqueItems',
  '$ref',
  '$id',
  '$anchor',
  '$dynamicRef',
  '$dynamicAnchor',
  '$defs',
] as const

/** A value chosen to be maximally disruptive if the keyword is read at all. */
const POLLUTANT: Partial<Record<(typeof KEYWORDS)[number], unknown>> = {
  additionalProperties: false,
  unevaluatedProperties: false,
  propertyNames: { pattern: '^zzz$' },
  patternProperties: { '^z': { type: 'number' } },
  properties: { ghost: { type: 'number' } },
  required: ['ghost'],
  dependentRequired: { a: ['ghost'] },
  dependentSchemas: { a: { required: ['ghost'] } },
  dependencies: { a: ['ghost'] },
  items: { type: 'number' },
  prefixItems: [{ type: 'number' }],
  contains: { type: 'number' },
  unevaluatedItems: false,
  not: {},
  if: { type: 'string' },
  then: { type: 'number' },
  else: { type: 'number' },
  allOf: [{ type: 'number' }],
  anyOf: [{ type: 'number' }],
  oneOf: [{ type: 'number' }],
  const: 'nope',
  enum: ['nope'],
  type: 'number',
  format: 'email',
  pattern: '^zzz$',
  minimum: 999,
  maximum: -999,
  minLength: 99,
  maxLength: 0,
  minItems: 99,
  maxItems: 0,
  minProperties: 99,
  maxProperties: 0,
  multipleOf: 7,
  uniqueItems: true,
  $ref: '#/$defs/Ghost',
  $id: 'https://ghost.example/',
  $anchor: 'ghost',
  $dynamicRef: '#ghost',
  $dynamicAnchor: 'ghost',
  $defs: { Ghost: { type: 'number' } },
}

const proto = Object.prototype as unknown as Record<string, unknown>

describe('a polluted Object.prototype', () => {
  afterEach(() => {
    for (const keyword of KEYWORDS) delete proto[keyword]
  })

  for (const keyword of KEYWORDS) {
    it(`does not let an inherited "${keyword}" change any verdict`, () => {
      // Three shapes that between them exercise the object, array and string
      // paths, each with a schema that plainly accepts the value.
      const cases: ReadonlyArray<[object, unknown]> = [
        [
          { type: 'object', properties: { a: { type: 'string' } } },
          { a: 'x', b: 1 },
        ],
        [{ type: 'array' }, ['x', 'y']],
        [{ type: 'string' }, 'hello'],
      ]

      proto[keyword] = POLLUTANT[keyword]
      for (const [schema, value] of cases) {
        // The schema literal is written clean, so any keyword the interpreter
        // acts on here came off the prototype.
        expect(validate(schema as never)(value), `${keyword} / ${JSON.stringify(schema)}`).toBe(true)
      }
    })
  }
})
