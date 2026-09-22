import Ajv from 'ajv/dist/2020'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'

import { buildSchema } from './build-schema'
import { linkGenerated } from './differential.test-utils'

/**
 * A strict parser promises to throw on every document its schema rejects. These
 * are the shapes where it silently did not, all reduced from a differential run
 * against Ajv over the published Scalar configuration schema
 * (`https://cdn.scalar.com/schema/scalar-config.json`), where 771 of 4000 mutated
 * documents were accepted by the generated parser and rejected by Ajv.
 *
 * Every one of them traced to a single chain:
 *
 *  - `generateShapeValidator` emitted the conservative `=> false` stub for any
 *    definition that had neither `properties` nor union branches — which is every
 *    *scalar* definition, `{ type: 'string' }` included;
 *  - `canTrustReferencedValidator` mirrored that by distrusting the same
 *    definitions, so a `$ref` to a plain string made its whole parent
 *    untrustworthy, and the distrust propagated up through every enclosing union;
 *  - with the union distrusted, `generateItemCheck` fell through to the inline
 *    subschema matcher, which refuses a union whose branch reaches a *cyclic*
 *    `$ref` (proving it inline would mean unrolling the cycle) and returned
 *    `null` — emitting no per-element check whatsoever.
 *
 * The result was an array whose elements were checked by nothing but
 * `Array.isArray`. The union *membership* check has no such limit, because it
 * inlines nothing: a `$ref` branch becomes a call to that definition's generated
 * `validate…Shape`, and a recursive definition's validator calls itself, so the
 * recursion bottoms out on the data rather than on the schema.
 *
 * Each case is asserted against Ajv rather than a hand-written verdict, so the
 * expectations cannot drift from the specification.
 */
const ajv = new Ajv({ strict: false, ownProperties: true })

/** Builds and links a strict parser for a schema whose `$ref` graph spans files. */
const strictParserFor = async (schema: JSONSchema): Promise<(input: unknown) => unknown> => {
  const files = await buildSchema(
    schema,
    'Root',
    undefined,
    false,
    false,
    true,
    'embedded',
    './',
    false,
    false,
    '',
    'js',
  )
  return linkGenerated<(input: unknown) => unknown>(files, 'index', 'parseRoot')
}

/** The generated source of one file in a build, for asserting on what was emitted. */
const generatedFile = async (schema: JSONSchema, filename: string, strict: boolean): Promise<string> => {
  const files = await buildSchema(
    schema,
    'Root',
    undefined,
    false,
    false,
    strict,
    'embedded',
    './',
    false,
    false,
    '',
    'js',
  )
  return files.find((file) => file.filename === filename)?.content ?? ''
}

/**
 * The reduced shape of the Scalar config's `guides`: an array whose `items` is a
 * union of two inline objects, one of which reaches a recursive definition. This
 * is the exact configuration that produced no element check at all.
 */
const RECURSIVE_UNION_ITEMS: JSONSchema = {
  type: 'object',
  properties: {
    rows: {
      type: 'array',
      items: {
        anyOf: [
          {
            type: 'object',
            properties: { kind: { const: 'leaf' }, value: { type: 'string' } },
            required: ['kind', 'value'],
          },
          {
            type: 'object',
            properties: { kind: { const: 'branch' }, children: { type: 'array', items: { $ref: '#/$defs/node' } } },
            required: ['kind', 'children'],
          },
        ],
      },
    },
  },
  $defs: {
    node: {
      anyOf: [
        {
          type: 'object',
          properties: { kind: { const: 'leaf' }, value: { type: 'string' } },
          required: ['kind', 'value'],
        },
        {
          type: 'object',
          properties: { kind: { const: 'branch' }, children: { type: 'array', items: { $ref: '#/$defs/node' } } },
          required: ['kind', 'children'],
        },
      ],
    },
  },
} as unknown as JSONSchema

/**
 * The second half of the chain: a union whose branches reach `$ref`s to *scalar*
 * definitions. Nothing here is recursive, so the only reason the elements went
 * unchecked was the stubbed validator for `{ type: 'string' }`.
 */
const SCALAR_REF_UNION_ITEMS: JSONSchema = {
  type: 'object',
  properties: {
    entries: {
      type: 'array',
      items: {
        anyOf: [
          {
            type: 'object',
            properties: { kind: { const: 'named' }, name: { $ref: '#/$defs/label' } },
            required: ['kind', 'name'],
          },
          {
            type: 'object',
            properties: { kind: { const: 'flagged' }, on: { $ref: '#/$defs/toggle' } },
            required: ['kind', 'on'],
          },
        ],
      },
    },
  },
  $defs: { label: { type: 'string' }, toggle: { type: 'boolean' } },
} as unknown as JSONSchema

describe('strict-recursive-union', () => {
  it.each([
    ['a well-typed leaf element', { rows: [{ kind: 'leaf', value: 'x' }] }],
    ['a primitive where an object is required', { rows: [5] }],
    ['a string where an object is required', { rows: ['x'] }],
    ['an element missing a required property', { rows: [{ kind: 'leaf' }] }],
    ['an element whose discriminant matches no branch', { rows: [{ kind: 'nope' }] }],
    [
      'a recursive child with a mistyped property',
      { rows: [{ kind: 'branch', children: [{ kind: 'leaf', value: 1 }] }] },
    ],
    ['a recursive child that is a primitive', { rows: [{ kind: 'branch', children: [7] }] }],
    [
      'recursion two levels deep with a bad leaf',
      {
        rows: [{ kind: 'branch', children: [{ kind: 'branch', children: [{ kind: 'leaf', value: 1 }] }] }],
      },
    ],
    ['an empty array', { rows: [] }],
    ['the property absent entirely', {}],
  ])('agrees with Ajv on %s', async (_label, document) => {
    const parse = await strictParserFor(RECURSIVE_UNION_ITEMS)
    const accepted = ajv.validate(structuredClone(RECURSIVE_UNION_ITEMS), structuredClone(document))

    let threw = false
    try {
      parse(structuredClone(document))
    } catch {
      threw = true
    }
    expect(threw).toBe(!accepted)
  })

  it.each([
    ['a valid named entry', { entries: [{ kind: 'named', name: 'x' }] }],
    ['a valid flagged entry', { entries: [{ kind: 'flagged', on: true }] }],
    ['a $ref-d string property given a number', { entries: [{ kind: 'named', name: 5 }] }],
    ['a $ref-d boolean property given a string', { entries: [{ kind: 'flagged', on: 'yes' }] }],
    ['an entry missing its $ref-d property', { entries: [{ kind: 'named' }] }],
  ])('agrees with Ajv on %s, where the branch reaches a $ref to a scalar', async (_label, document) => {
    const parse = await strictParserFor(SCALAR_REF_UNION_ITEMS)
    const accepted = ajv.validate(structuredClone(SCALAR_REF_UNION_ITEMS), structuredClone(document))

    let threw = false
    try {
      parse(structuredClone(document))
    } catch {
      threw = true
    }
    expect(threw).toBe(!accepted)
  })

  it('returns an accepted document unchanged rather than coercing it', async () => {
    const parse = await strictParserFor(RECURSIVE_UNION_ITEMS)
    const document = {
      rows: [
        { kind: 'leaf', value: 'x' },
        { kind: 'branch', children: [{ kind: 'leaf', value: 'y' }] },
      ],
    }

    expect(parse(structuredClone(document))).toStrictEqual(document)
  })

  it('emits a per-element check for a recursive union, not a bare Array.isArray', async () => {
    const source = await generatedFile(RECURSIVE_UNION_ITEMS, 'root.ts', true)

    // The regression was an array property whose only guard was its own type.
    // The element check is what proves the union is enforced at all.
    expect(source).toContain('items do not match the item schema')
  })

  /**
   * The root cause, pinned directly: a scalar definition must generate a real
   * predicate. While these stubbed to `=> false`, every union that reached one
   * was demoted to unenforceable — and a `false` from a stub also means a *valid*
   * value can be reported as out of shape, so the stub was never merely a missed
   * optimization.
   */
  it.each([
    ['a plain string definition', { type: 'string' }, 'validateLabelShape'],
    ['a constrained string definition', { type: 'string', minLength: 1, pattern: '^[a-z]+$' }, 'validateLabelShape'],
    ['a boolean definition', { type: 'boolean' }, 'validateLabelShape'],
    ['an integer definition', { type: 'integer', minimum: 3 }, 'validateLabelShape'],
    ['an enum definition', { enum: ['a', 'b'] }, 'validateLabelShape'],
  ])('generates a real shape validator for %s', async (_label, definition, validatorName) => {
    const schema = {
      type: 'object',
      properties: { value: { $ref: '#/$defs/label' } },
      $defs: { label: definition },
    } as unknown as JSONSchema

    const source = await generatedFile(schema, 'label.ts', true)

    expect(source).toContain(`export const ${validatorName} =`)
    expect(source).not.toContain(`export const ${validatorName} = (_input: unknown): boolean => false;`)
  })

  /**
   * A constrained scalar definition's shape validator carries the constraints,
   * not just the `typeof` test — a parent's fast path returns the value unparsed
   * when this says true, so a pattern miss reported as "in shape" would be
   * returned without ever being checked.
   */
  it('carries a scalar definition constraints into its shape validator', async () => {
    const schema = {
      type: 'object',
      properties: { slug: { $ref: '#/$defs/slug' } },
      $defs: { slug: { type: 'string', minLength: 1, maxLength: 60, pattern: '^[a-z][a-z0-9-]*$' } },
    } as unknown as JSONSchema

    const source = await generatedFile(schema, 'slug.ts', true)

    expect(source).toContain('typeof input === "string"')
    expect(source).toContain('test(input)')
  })
})
