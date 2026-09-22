import Ajv from 'ajv/dist/2020'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'

import { buildSchema } from './build-schema'
import { linkGenerated } from './differential.test-utils'

/**
 * A coercing parser repairs rather than rejects, and its contract is that
 * whatever it hands back is a valid instance of the schema that produced it
 * (`coerced-output-validity.differential.test.ts` fuzzes exactly that property).
 *
 * A *`$ref`-d* constrained scalar broke it in two ways at once, and neither was
 * visible to that fuzzer, which only ever builds inline schemas:
 *
 *  - the root scalar parser was a flat `typeof` test, so a value of the right
 *    type but the wrong shape — `"Bad Slug"` against a `pattern` — was handed
 *    straight back unrepaired;
 *  - its fallback was the literal `""`, which is not an instance of a schema
 *    with `minLength: 1` or a `pattern`, so even the repair path produced an
 *    invalid document.
 *
 * Both halves are asserted against Ajv rather than against a fixed expected
 * string, because the contract is "valid", not "equal to this value".
 */
const ajv = new Ajv({ strict: false, ownProperties: true })

const SLUG_SCHEMA = {
  type: 'object',
  properties: {
    slug: { $ref: '#/$defs/slug' },
    list: { type: 'array', items: { $ref: '#/$defs/slug' } },
    count: { $ref: '#/$defs/count' },
  },
  $defs: {
    slug: { type: 'string', minLength: 1, maxLength: 60, pattern: '^[a-z](?:[a-z0-9-]*[a-z0-9])?$' },
    count: { type: 'integer', minimum: 5, maximum: 10 },
  },
} as unknown as JSONSchema

const coercingParserFor = async (schema: JSONSchema): Promise<(input: unknown) => unknown> => {
  const files = await buildSchema(
    schema,
    'Root',
    undefined,
    false,
    false,
    false,
    'embedded',
    './',
    false,
    false,
    '',
    'js',
  )
  return linkGenerated<(input: unknown) => unknown>(files, 'index', 'parseRoot')
}

describe('coerce-scalar-ref', () => {
  it.each([
    ['a value that already conforms', { slug: 'acme-docs' }],
    ['a string the pattern rejects', { slug: 'Bad Slug' }],
    ['an empty string below minLength', { slug: '' }],
    ['a string past maxLength', { slug: 'a'.repeat(61) }],
    ['a number where a patterned string is declared', { slug: 5 }],
    ['null where a patterned string is declared', { slug: null }],
    ['an object where a patterned string is declared', { slug: { a: 1 } }],
    ['an array element the pattern rejects', { list: ['ok', 'Bad Slug'] }],
    ['an array element of the wrong type', { list: ['ok', 5] }],
    ['an integer below its minimum', { count: 1 }],
    ['an integer above its maximum', { count: 99 }],
    ['a non-integer where an integer is declared', { count: 1.5 }],
    ['a numeric string where an integer is declared', { count: '7' }],
    ['every constrained field wrong at once', { slug: 'X', list: [1, 'Y'], count: -3 }],
  ])('repairs %s into a document its own schema accepts', async (_label, document) => {
    const parse = await coercingParserFor(SLUG_SCHEMA)

    const output = parse(structuredClone(document))

    expect(ajv.validate(structuredClone(SLUG_SCHEMA), structuredClone(output))).toBe(true)
  })

  it('leaves an already-valid document untouched', async () => {
    const parse = await coercingParserFor(SLUG_SCHEMA)
    const document = { slug: 'acme-docs', list: ['a', 'b-1'], count: 7 }

    expect(parse(structuredClone(document))).toStrictEqual(document)
  })

  /**
   * The emitted form matters as much as the behaviour: a flat `typeof` test is
   * how the constraints went missing, so its absence is what stops the
   * regression coming back by a different route.
   */
  it('emits a constraint-aware coercion for a constrained scalar definition, not a bare typeof', async () => {
    const files = await buildSchema(
      SLUG_SCHEMA,
      'Root',
      undefined,
      false,
      false,
      false,
      'embedded',
      './',
      false,
      false,
      '',
      'js',
    )
    const source = files.find((file) => file.filename === 'slug.ts')?.content ?? ''

    expect(source).not.toContain('typeof input === "string" ? input as Slug : "" as Slug')
    expect(source).toContain('test(')
  })
})
