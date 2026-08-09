import { describe, expect, it } from 'vitest'

import { isDraft07Schema, upgradeDraft07Schema } from './upgrade-draft07-schema'

describe('upgrade-draft07-schema', () => {
  const draft07 = <T extends Record<string, unknown>>(schema: T): Record<string, unknown> => ({
    $schema: 'http://json-schema.org/draft-07/schema#',
    ...schema,
  })

  it('recognises a draft-07 document by its $schema', () => {
    expect(isDraft07Schema({ $schema: 'http://json-schema.org/draft-07/schema#' })).toBe(true)
    expect(isDraft07Schema({ $schema: 'https://json-schema.org/draft/2020-12/schema' })).toBe(false)
    expect(isDraft07Schema({})).toBe(false)
  })

  it('leaves a document that is not draft-07 untouched', () => {
    const schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', definitions: { a: { type: 'string' } } }
    expect(upgradeDraft07Schema(schema)).toBe(schema)
  })

  it('renames the root definitions block to $defs', () => {
    expect(upgradeDraft07Schema(draft07({ definitions: { thing: { type: 'string' } } }))).toEqual({
      $defs: { thing: { type: 'string' } },
    })
  })

  // The rename moves the block, so every pointer written against the old name has
  // to move with it. Refs written *inside* `definitions` were always rewritten;
  // refs written anywhere else were not, and since the block they name no longer
  // exists the generators stopped with "Could not resolve $ref" — a draft-07
  // document with an ordinary `properties: { a: { $ref: "#/definitions/x" } }`
  // could not be generated at all.
  const OUTSIDE_DEFINITIONS: readonly { where: string; schema: Record<string, unknown> }[] = [
    { where: 'a property', schema: { properties: { a: { $ref: '#/definitions/thing' } } } },
    { where: 'the document root', schema: { $ref: '#/definitions/thing' } },
    { where: 'items', schema: { type: 'array', items: { $ref: '#/definitions/thing' } } },
    { where: 'a tuple position', schema: { type: 'array', items: [{ $ref: '#/definitions/thing' }] } },
    { where: 'allOf', schema: { allOf: [{ $ref: '#/definitions/thing' }] } },
    { where: 'additionalProperties', schema: { additionalProperties: { $ref: '#/definitions/thing' } } },
    { where: 'patternProperties', schema: { patternProperties: { '^a': { $ref: '#/definitions/thing' } } } },
    { where: 'not', schema: { not: { $ref: '#/definitions/thing' } } },
    { where: 'if/then', schema: { if: { type: 'string' }, then: { $ref: '#/definitions/thing' } } },
    {
      where: 'a nested property',
      schema: { properties: { a: { properties: { b: { $ref: '#/definitions/thing' } } } } },
    },
  ]

  for (const { where, schema } of OUTSIDE_DEFINITIONS) {
    it(`rewrites a #/definitions ref written in ${where}`, () => {
      const upgraded = JSON.stringify(upgradeDraft07Schema(draft07({ ...schema, definitions: { thing: {} } })))
      expect(upgraded).toContain('#/$defs/thing')
      expect(upgraded).not.toContain('#/definitions/thing')
    })
  }

  it('keeps rewriting refs written inside definitions', () => {
    const upgraded = upgradeDraft07Schema(
      draft07({
        definitions: {
          thing: { type: 'string' },
          holder: { properties: { a: { $ref: '#/definitions/thing' } } },
        },
      }),
    )
    expect(upgraded).toEqual({
      $defs: {
        thing: { type: 'string' },
        holder: { properties: { a: { $ref: '#/$defs/thing' } } },
      },
    })
  })

  it('does not touch a ref that names something other than definitions', () => {
    // Only the block that actually moved gets rewritten. A pointer into
    // `properties`, an anchor, or an external URI still means what it said.
    const upgraded = upgradeDraft07Schema(
      draft07({
        properties: {
          a: { $ref: '#/properties/b' },
          b: { $ref: '#thing' },
          c: { $ref: 'https://example.com/other.json#/definitions/thing' },
        },
        definitions: { thing: {} },
      }),
    )
    expect(upgraded['properties']).toEqual({
      a: { $ref: '#/properties/b' },
      b: { $ref: '#thing' },
      c: { $ref: 'https://example.com/other.json#/definitions/thing' },
    })
  })

  it('leaves a property literally named "definitions" in place', () => {
    // The rename applies to the keyword, not to every key spelled that way: a
    // document describing an object with a `definitions` field still describes
    // that field, and its ref has to keep pointing at it.
    const upgraded = upgradeDraft07Schema(
      draft07({ properties: { definitions: { type: 'object' }, a: { $ref: '#/properties/definitions' } } }),
    )
    expect(upgraded['properties']).toEqual({
      definitions: { type: 'object' },
      a: { $ref: '#/properties/definitions' },
    })
  })

  it('hoists a nested definitions block to the root with a prefixed name', () => {
    const upgraded = upgradeDraft07Schema(
      draft07({
        definitions: {
          parent: { definitions: { child: { type: 'number' } }, properties: { c: { $ref: '#/definitions/child' } } },
        },
      }),
    )
    const defs = upgraded['$defs'] as Record<string, unknown>
    expect(defs['parent-child']).toEqual({ type: 'number' })
    expect((defs['parent'] as Record<string, unknown>)['properties']).toEqual({ c: { $ref: '#/$defs/parent-child' } })
  })

  it('drops the draft-07 $schema declaration', () => {
    expect(upgradeDraft07Schema(draft07({ type: 'string' }))).toEqual({ type: 'string', $defs: {} })
  })
})
