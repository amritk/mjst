import Ajv from 'ajv/dist/2020'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'

import { buildSchema } from './build-schema'
import { linkGenerated, makeRng, pick } from './differential.test-utils'

/**
 * A coercing parser's contract is that whatever it returns is a valid instance
 * of the schema that produced it. A union-typed array element broke that
 * contract completely: with no discriminated `$ref` dispatch to fall back on,
 * the parser emitted a blind `input as T` cast, so every element of `guides`,
 * `references` and `header` in the Scalar configuration schema was handed back
 * exactly as it arrived. Over 4000 mutated documents, 2418 coerced outputs were
 * invalid against their own schema; with this dispatch, 41 are, and all 41 sit at
 * one site — a union in *property* position, the shape noted in the README.
 *
 * The dispatch has two halves, and both are asserted here:
 *
 *  - **Recognition.** Each branch's shape predicate runs first, so a value
 *    already in a branch's shape takes that branch's parser and comes back
 *    unchanged. Nothing is scored, and nothing is rebuilt.
 *  - **Repair.** A value matching no branch is scored against every branch and
 *    repaired toward the best fit. Picking the *first* branch instead would
 *    coerce `{ name, folder }` toward a branch requiring `sidebar`, inventing
 *    one and discarding `folder` — so the choice has to read the evidence.
 *
 * Validity is asserted against Ajv rather than against expected literals: the
 * contract is "valid", and pinning exact repaired values would freeze incidental
 * choices that are free to change.
 */
const ajv = new Ajv({ strict: false, ownProperties: true })

/** The reduced shape of the Scalar config's `guides`: a union of two untagged branches. */
const UNTAGGED_UNION_ITEMS = {
  type: 'object',
  properties: {
    guides: {
      type: 'array',
      items: {
        anyOf: [
          {
            type: 'object',
            properties: { name: { type: 'string' }, folder: { type: 'string' } },
            required: ['name', 'folder'],
          },
          {
            type: 'object',
            properties: { name: { type: 'string' }, sidebar: { type: 'array', items: { type: 'string' } } },
            required: ['name', 'sidebar'],
          },
        ],
      },
    },
  },
} as unknown as JSONSchema

/** A union tagged by `const`, plus a recursive branch — the sidebar node shape. */
const TAGGED_RECURSIVE_UNION_ITEMS = {
  type: 'object',
  properties: { rows: { type: 'array', items: { $ref: '#/$defs/node' } } },
  $defs: {
    node: {
      anyOf: [
        {
          type: 'object',
          properties: { type: { const: 'link' }, url: { type: 'string' } },
          required: ['type', 'url'],
        },
        {
          type: 'object',
          properties: {
            type: { const: 'folder' },
            name: { type: 'string' },
            children: { type: 'array', items: { $ref: '#/$defs/node' } },
          },
          required: ['type', 'name', 'children'],
        },
      ],
    },
  },
} as unknown as JSONSchema

/** A union whose branches are scalars — the `icon: enum | uri | string` shape. */
const SCALAR_BRANCH_UNION_ITEMS = {
  type: 'object',
  properties: { icons: { type: 'array', items: { $ref: '#/$defs/icon' } } },
  $defs: { icon: { anyOf: [{ enum: ['home', 'gear'] }, { type: 'string' }] } },
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

describe('coerce-union-dispatch', () => {
  it.each([
    ['an element of the wrong type entirely', UNTAGGED_UNION_ITEMS, { guides: [5] }],
    ['an element missing every required property', UNTAGGED_UNION_ITEMS, { guides: [{}] }],
    ['a mistyped property on an otherwise clear branch', UNTAGGED_UNION_ITEMS, { guides: [{ name: 'g', folder: 5 }] }],
    ['a half-formed element', UNTAGGED_UNION_ITEMS, { guides: [{ name: 'g' }] }],
    ['several broken elements at once', UNTAGGED_UNION_ITEMS, { guides: [5, {}, { folder: true }] }],
    ['a tagged element with a mistyped property', TAGGED_RECURSIVE_UNION_ITEMS, { rows: [{ type: 'link', url: 9 }] }],
    ['a tag matching no branch', TAGGED_RECURSIVE_UNION_ITEMS, { rows: [{ type: 'nope' }] }],
    [
      'a broken element nested in a recursive branch',
      TAGGED_RECURSIVE_UNION_ITEMS,
      {
        rows: [{ type: 'folder', name: 'f', children: [{ type: 'link', url: 9 }] }],
      },
    ],
    [
      'recursion two levels deep',
      TAGGED_RECURSIVE_UNION_ITEMS,
      {
        rows: [{ type: 'folder', name: 'f', children: [{ type: 'folder', name: 'g', children: [7] }] }],
      },
    ],
    ['a scalar-branch union given a number', SCALAR_BRANCH_UNION_ITEMS, { icons: [5] }],
    ['a scalar-branch union given an object', SCALAR_BRANCH_UNION_ITEMS, { icons: [{}] }],
  ])('repairs %s into a document its own schema accepts', async (_label, schema, document) => {
    const parse = await coercingParserFor(schema)

    const output = parse(structuredClone(document))

    expect(ajv.validate(structuredClone(schema), structuredClone(output))).toBe(true)
  })

  it.each([
    [
      'an untagged union',
      UNTAGGED_UNION_ITEMS,
      {
        guides: [
          { name: 'a', folder: 'f' },
          { name: 'b', sidebar: ['x'] },
        ],
      },
    ],
    [
      'a tagged recursive union',
      TAGGED_RECURSIVE_UNION_ITEMS,
      {
        rows: [
          { type: 'link', url: '/' },
          { type: 'folder', name: 'f', children: [{ type: 'link', url: '/a' }] },
        ],
      },
    ],
    ['a scalar-branch union', SCALAR_BRANCH_UNION_ITEMS, { icons: ['home', 'anything'] }],
  ])('returns an already-valid document unchanged for %s', async (_label, schema, document) => {
    const parse = await coercingParserFor(schema)

    expect(parse(structuredClone(document))).toStrictEqual(document)
  })

  /**
   * The point of scoring rather than taking the first branch. Both elements are
   * broken in the same way — one required property has the wrong type — but they
   * belong to different branches, and only the keys actually present say which.
   */
  it('repairs toward the branch the value most resembles, not the first one', async () => {
    const parse = await coercingParserFor(UNTAGGED_UNION_ITEMS)

    const output = parse({
      guides: [
        { name: 'g', folder: 5 },
        { name: 'h', sidebar: 'not-an-array' },
      ],
    }) as {
      guides: Record<string, unknown>[]
    }

    // Scored toward the `folder` branch: the key that is present is the evidence.
    expect(output.guides[0]).toHaveProperty('folder')
    expect(output.guides[0]).not.toHaveProperty('sidebar')
    // And the second toward the `sidebar` branch, for the same reason.
    expect(output.guides[1]).toHaveProperty('sidebar')
    expect(output.guides[1]).not.toHaveProperty('folder')
  })

  it('uses a const tag as the deciding evidence when one is present', async () => {
    const parse = await coercingParserFor(TAGGED_RECURSIVE_UNION_ITEMS)

    // Carries `name` and `children`, which are the *folder* branch's keys — but
    // the tag says link, and a tag outweighs any accumulation of key evidence.
    const output = parse({ rows: [{ type: 'link', name: 'n', children: [] }] }) as {
      rows: Record<string, unknown>[]
    }

    expect(output.rows[0]?.['type']).toBe('link')
    expect(output.rows[0]).toHaveProperty('url')
  })

  /**
   * The fast path must not be paid for by valid input: a value already in a
   * branch's shape is recognized by that branch's predicate and returned by its
   * parser, so the scoring arithmetic is never evaluated.
   */
  it('emits the shape predicates ahead of the scoring arithmetic', async () => {
    const files = await buildSchema(
      TAGGED_RECURSIVE_UNION_ITEMS,
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
    const source = files.find((file) => file.filename === 'node.ts')?.content ?? ''

    expect(source).not.toContain('export const parseNode = (input: unknown): Node => input as Node;')
    const firstPredicate = source.indexOf('Shape(input)) return')
    const firstScore = source.indexOf('const _s0 =')
    expect(firstPredicate).toBeGreaterThan(-1)
    expect(firstScore).toBeGreaterThan(firstPredicate)
  })

  /**
   * The property the per-case tests above sample: over arbitrary junk, a coerced
   * document is always a valid instance of its own schema. This is the guard
   * that would have caught the original defect, which no existing fuzzer could
   * see because none of them built a union-typed array.
   */
  it.each([0x11, 0x22, 0x33])('coerces arbitrary junk into a valid document (seed %i)', async (seed) => {
    const parse = await coercingParserFor(UNTAGGED_UNION_ITEMS)
    const rng = makeRng(seed)
    const junk = [5, 'x', true, null, {}, [], { name: 'g' }, { folder: 1 }, { sidebar: 'no' }, { name: 2, folder: 3 }]

    for (let i = 0; i < 200; i++) {
      const document = { guides: Array.from({ length: Math.floor(rng() * 4) }, () => structuredClone(pick(rng, junk))) }
      const output = parse(structuredClone(document))

      expect(ajv.validate(structuredClone(UNTAGGED_UNION_ITEMS), structuredClone(output))).toBe(true)
    }
  })
})
