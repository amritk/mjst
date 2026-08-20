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
  '$schema',
  '$vocabulary',
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
  // Together these two turned *every* assertion off: an inherited `$schema`
  // named a document already in the registry (the schema itself), and an
  // inherited `$vocabulary` listing no vocabularies said that dialect drops the
  // validation one — so `type`, `enum`, `required` and the bounds all became
  // annotations and the validator accepted anything.
  $schema: 'https://runtime-validators.invalid/schema',
  $vocabulary: {},
}

const proto = Object.prototype as unknown as Record<string, unknown>

describe('a polluted Object.prototype', () => {
  afterEach(() => {
    for (const keyword of KEYWORDS) delete proto[keyword]
  })

  it('does not let an inherited $anchor make an unresolvable ref resolve', () => {
    // The verdict cases below all use refs that resolve, so a phantom anchor
    // has nothing to change in them. This is the shape that exposes one: a ref
    // naming something the document never declared has to keep failing.
    proto['$anchor'] = 'ghost'
    expect(() => validate({ type: 'object', properties: { a: { $ref: '#ghost' } } } as never)({ a: 1 })).toThrow(
      /Cannot resolve \$ref/,
    )
  })

  it('does not let an inherited $dynamicAnchor make an unresolvable $dynamicRef resolve', () => {
    proto['$dynamicAnchor'] = 'ghost'
    expect(() => validate({ type: 'object', properties: { a: { $dynamicRef: '#ghost' } } } as never)({ a: 1 })).toThrow(
      /Cannot resolve \$dynamicRef/,
    )
  })

  it('does not let an inherited $vocabulary turn the validation vocabulary off', () => {
    // The verdict cases below are written to *pass*, so a keyword that stops
    // asserting changes nothing in them. This is the shape that exposes it: an
    // instance the schema must reject has to keep being rejected.
    proto['$schema'] = 'https://runtime-validators.invalid/schema'
    proto['$vocabulary'] = {}
    // An `$id` anywhere is what builds the registry the dialect is read from.
    expect(validate({ $id: 'https://real.example/root', type: 'string' } as never)(42)).not.toBe(true)
  })

  for (const keyword of KEYWORDS) {
    it(`does not let an inherited "${keyword}" change any verdict`, () => {
      // Shapes that between them exercise the object, array and string paths,
      // plus the `$defs`/`$ref`/anchor machinery — without which an inherited
      // `$anchor` or `$dynamicAnchor` has nothing to bind to and the case
      // passes for the wrong reason, which is how two of these were missed.
      const cases: ReadonlyArray<[object, unknown]> = [
        [
          { type: 'object', properties: { a: { type: 'string' } } },
          { a: 'x', b: 1 },
        ],
        [{ type: 'array' }, ['x', 'y']],
        [{ type: 'string' }, 'hello'],
        [{ $defs: { S: { type: 'string' } }, type: 'object', properties: { a: { $ref: '#/$defs/S' } } }, { a: 'x' }],
        [
          {
            $id: 'https://real.example/root',
            $defs: { S: { $anchor: 'real', type: 'string' } },
            type: 'object',
            properties: { a: { $ref: '#real' } },
          },
          { a: 'x' },
        ],
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
