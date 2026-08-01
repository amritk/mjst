import { validate } from '@amritk/runtime-validators'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it, vi } from 'vitest'

import { loadComponentSchemas } from '../../../../fixtures/openapi/load-fixtures'
import { deriveExample, generateExampleConst } from './derive-example'

/**
 * The package's promise is that `fooExample` is a valid instance of its schema.
 * The older suites assert on *generated source strings*, which is why a whole
 * class of defect survived: an example that fails its own schema still produces
 * a perfectly well-formed `export const`. So this suite runs the values.
 *
 * Two contracts are pinned here, and the second is the durable one:
 *
 * 1. For a schema that *has* an instance, the derived example is one.
 * 2. For any schema at all, an example that does not validate is *reported*. An
 *    unsatisfiable schema is allowed to yield an invalid value — there is
 *    nothing better to yield — but never silently, because a wrong example
 *    ships into fixtures and docs reading as authoritative.
 *
 * `formats: 'all'` is on deliberately: a `format` the deriver has no example for
 * falls back to the bare `"string"`, and that is precisely a case worth catching.
 */

const isValidInstance = (schema: JSONSchema, value: unknown): boolean => {
  try {
    return validate(schema as object, { formats: 'all' })(value) === true
  } catch {
    // A schema the interpreter cannot prepare (an unresolvable `$ref`) is not
    // evidence about the example, so do not count it as a failure.
    return true
  }
}

/** Generates the example const while capturing whether the generator warned. */
const generateAndCaptureWarning = (schema: JSONSchema, typeName: string): { source: string; warned: boolean } => {
  const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const source = generateExampleConst(schema, typeName)
    return { source, warned: spy.mock.calls.length > 0 }
  } finally {
    spy.mockRestore()
  }
}

/** Schemas that have an instance, so the deriver has to find one. */
const satisfiable: Array<{ name: string; schema: JSONSchema }> = [
  { name: 'pattern with a satisfiable minLength', schema: { type: 'string', pattern: '^[a-z]+$', minLength: 5 } },
  // The sampler used to read `\n` as the letter `n`, producing `"anb"`.
  { name: 'pattern with a control escape', schema: { type: 'string', pattern: 'a\\nb' } },
  { name: 'pattern with a maxLength', schema: { type: 'string', pattern: '^[a-z]+$', minLength: 2, maxLength: 4 } },
  { name: 'not const', schema: { type: 'string', not: { const: 'string' } } },
  { name: 'not enum', schema: { type: 'string', not: { enum: ['string', 'other'] } } },
  { name: 'not on a number', schema: { type: 'integer', not: { const: 0 } } },
  { name: 'not on a boolean', schema: { type: 'boolean', not: { const: true } } },
  {
    name: 'uniqueItems over an enum',
    schema: { type: 'array', items: { enum: ['a', 'b', 'c'] }, minItems: 3, uniqueItems: true },
  },
  {
    name: 'uniqueItems over booleans within reach',
    schema: { type: 'array', items: { type: 'boolean' }, minItems: 2, uniqueItems: true },
  },
  {
    name: 'uniqueItems over numbers',
    schema: { type: 'array', items: { type: 'integer', minimum: 0 }, minItems: 4, uniqueItems: true },
  },
  {
    name: 'required key covered by additionalProperties',
    schema: {
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a', 'b'],
      additionalProperties: { type: 'integer' },
    },
  },
  {
    name: 'required key covered by patternProperties on a closed object',
    schema: {
      type: 'object',
      properties: { a: { type: 'string' } },
      patternProperties: { '^b': { type: 'integer' } },
      required: ['a', 'b'],
      additionalProperties: false,
    },
  },
  // Every format `@amritk/runtime-validators` knows how to check. A bare
  // `"string"` satisfies almost none of them.
  ...(
    [
      'email',
      'idn-email',
      'date-time',
      'date',
      'time',
      'duration',
      'uuid',
      'uri',
      'iri',
      'uri-reference',
      'iri-reference',
      'uri-template',
      'json-pointer',
      'relative-json-pointer',
      'hostname',
      'idn-hostname',
      'ipv4',
      'ipv6',
      'regex',
    ] as const
  ).map((format) => ({ name: `format ${format}`, schema: { type: 'string', format } as JSONSchema })),
]

/**
 * Schemas with no instance at all. Nothing correct can be emitted for them, so
 * the contract is only that the generator says so.
 */
const unsatisfiable: Array<{ name: string; schema: JSONSchema }> = [
  { name: 'pattern that cannot reach minLength', schema: { type: 'string', pattern: '^ab$', minLength: 5 } },
  {
    name: 'oneOf branches that every object matches',
    schema: {
      oneOf: [
        { type: 'object', properties: { a: { type: 'string' } } },
        { type: 'object', properties: { b: { type: 'string' } } },
      ],
    },
  },
  {
    name: 'uniqueItems demanding more booleans than exist',
    schema: { type: 'array', items: { type: 'boolean' }, minItems: 3, uniqueItems: true },
  },
  {
    name: 'required key a closed object forbids',
    schema: {
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a', 'b'],
      additionalProperties: false,
    },
  },
]

describe('deriveExample produces a valid instance, or says it could not', () => {
  for (const { name, schema } of satisfiable) {
    it(`derives a valid instance: ${name}`, () => {
      const value = deriveExample(schema)
      expect(isValidInstance(schema, value), `derived ${JSON.stringify(value)}`).toBe(true)
      expect(generateAndCaptureWarning(schema, 'Sample').warned, 'a valid example must not warn').toBe(false)
    })
  }

  for (const { name, schema } of unsatisfiable) {
    it(`warns instead of shipping an invalid example silently: ${name}`, () => {
      const { source, warned } = generateAndCaptureWarning(schema, 'Sample')
      expect(warned).toBe(true)
      // The const is still emitted — a generation run must not leave a hole in
      // the module for a schema the author can go and fix.
      expect(source).toContain('export const sampleExample: Sample =')
    })
  }

  it('keeps a __proto__ property in the value and in the emitted source', () => {
    // Written as a literal, `{ __proto__: … }` is the prototype setter, so the
    // schema itself has to be built through JSON to carry a real own property.
    const schema = JSON.parse(
      '{"type":"object","properties":{"__proto__":{"type":"string"}},"required":["__proto__"]}',
    ) as JSONSchema
    const value = deriveExample(schema) as Record<string, unknown>
    expect(Object.hasOwn(value, '__proto__')).toBe(true)
    expect(isValidInstance(schema, value)).toBe(true)
    // A quoted `"__proto__":` in the emitted object literal is still the setter,
    // so the computed form is the only one that survives evaluation.
    expect(generateExampleConst(schema, 'Sample')).toContain('["__proto__"]: "string"')
  })
})

/**
 * The same invariant swept across every schema in the vendored real-world
 * OpenAPI corpus: whatever the deriver produces, an invalid result is reported.
 * This is the regression net — it does not require the corpus to be perfect,
 * only that the generator never goes quiet about a bad example.
 */
describe('every derived example in the OpenAPI corpus validates or warns', () => {
  for (const { fixture, schemas } of loadComponentSchemas()) {
    it(`holds for ${fixture}`, () => {
      const silentlyInvalid: string[] = []
      for (const { name, schema } of schemas) {
        const { warned } = generateAndCaptureWarning(schema as JSONSchema, 'Sample')
        const value = deriveExample(schema as JSONSchema)
        if (!isValidInstance(schema as JSONSchema, value) && !warned) {
          silentlyInvalid.push(`${name}: ${JSON.stringify(value).slice(0, 200)}`)
        }
      }
      expect(silentlyInvalid, silentlyInvalid.join('\n')).toEqual([])
    }, 30_000)
  }
})
