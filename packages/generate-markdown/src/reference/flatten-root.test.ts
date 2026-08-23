import { describe, expect, it } from 'vitest'
import { flattenRoot } from '#reference/flatten-root'

describe('flatten-root', () => {
  it('leaves a plain object schema alone', () => {
    const schema = { properties: { a: { type: 'string' } }, required: ['a'] }
    expect(flattenRoot(schema)).toStrictEqual(schema)
  })

  // `allOf: [{ $ref: Base }]` where the base only restates `required` is the
  // OpenAPI inheritance idiom, and it names no property the root does not
  // already list — so the early return handed the schema back untouched and
  // every marker that arrived that way was dropped.
  it('keeps a requirement a root composes in without naming a new field', () => {
    const flattened = flattenRoot({ properties: { a: { type: 'string' } }, allOf: [{ required: ['a'] }] })
    expect(flattened.required).toEqual(['a'])
  })

  // "A config with `versions`, or one without" is how a generated schema spells
  // an optional property at the root. Without flattening, the whole document
  // would render as a title and nothing else.
  it('merges the properties of an anyOf root', () => {
    const flattened = flattenRoot({
      anyOf: [
        { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
        { type: 'object', properties: { b: { type: 'number' } } },
      ],
    })
    expect(flattened.properties).toEqual({ a: { type: 'string' }, b: { type: 'number' } })
  })

  it('keeps the first declaration of a property that several branches share', () => {
    const flattened = flattenRoot({
      anyOf: [
        { properties: { a: { type: 'string', description: 'First.' } } },
        { properties: { a: { type: 'string', description: 'Second.' } } },
      ],
    })
    expect(flattened.properties?.['a']?.description).toBe('First.')
  })

  // With `anyOf`, a document that satisfies the branch not requiring it is
  // still valid, so calling the property required would be a lie — and a branch
  // that never mentions the property is exactly such a document.
  it('marks a property required only when every branch requires it', () => {
    const flattened = flattenRoot({
      anyOf: [
        { properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a', 'b'] },
        { properties: { a: { type: 'string' } }, required: ['a'] },
      ],
    })
    expect(flattened.required).toEqual(['a'])
  })

  // The shape a generated root takes: "a config with `versions`, or one with
  // `navigation`". Neither is required — the reader picks a form.
  it('requires neither side of two mutually exclusive branches', () => {
    const flattened = flattenRoot({
      anyOf: [
        { properties: { versions: { type: 'object' } }, required: ['versions'] },
        { properties: { navigation: { type: 'object' } }, required: ['navigation'] },
      ],
    })
    expect(Object.keys(flattened.properties ?? {})).toEqual(['versions', 'navigation'])
    expect(flattened.required).toEqual([])
  })

  // `allOf` branches all apply, so their requirements all hold.
  it('unions the requirements of allOf branches', () => {
    const flattened = flattenRoot({
      properties: { a: { type: 'string' } },
      required: ['a'],
      allOf: [{ properties: { b: { type: 'string' } }, required: ['b'] }],
    })
    expect(Object.keys(flattened.properties ?? {})).toEqual(['a', 'b'])
    expect(flattened.required).toEqual(['a', 'b'])
  })

  // The early return used to fire whenever the root declared any properties of
  // its own, so an inheriting root lost everything it inherited.
  it('merges an allOf branch into the root own properties', () => {
    const flattened = flattenRoot({
      title: 'R',
      properties: { bar: { type: 'integer' } },
      allOf: [{ properties: { foo: { type: 'string', description: 'foo doc' } } }],
    })
    expect(Object.keys(flattened.properties ?? {})).toEqual(['bar', 'foo'])
  })

  it('keeps the root required list when the root is flattened', () => {
    const flattened = flattenRoot({ required: ['a'], anyOf: [{ properties: { a: { type: 'string' } } }] })
    expect(flattened.required).toEqual(['a'])
  })

  // A config that is one big keyed bag describes itself through
  // `additionalProperties`, and used to render as a title and nothing else.
  it('documents the value shape of a map-like root', () => {
    const flattened = flattenRoot({
      title: 'M',
      type: 'object',
      additionalProperties: { type: 'object', properties: { a: { type: 'string' } } },
    } as never)
    expect(Object.keys(flattened.properties ?? {})).toEqual(['a'])
  })

  it('documents the item shape of an array-like root', () => {
    const flattened = flattenRoot({
      title: 'L',
      type: 'array',
      items: { type: 'object', properties: { a: { type: 'string' } } },
    } as never)
    expect(Object.keys(flattened.properties ?? {})).toEqual(['a'])
  })

  it('drops a requirement one branch does not share', () => {
    const flattened = flattenRoot({
      anyOf: [{ properties: { a: { type: 'string' } }, required: ['a'] }, { properties: { a: { type: 'string' } } }],
    })
    expect(flattened.required).toEqual([])
  })

  it('reads oneOf and allOf the same way', () => {
    expect(flattenRoot({ oneOf: [{ properties: { a: {} } }] }).properties).toEqual({ a: {} })
    expect(flattenRoot({ allOf: [{ properties: { a: {} } }] }).properties).toEqual({ a: {} })
  })

  it('takes the title and docs config from a branch when the root has none', () => {
    const flattened = flattenRoot({
      anyOf: [{ title: 'Config', 'x-doc': { language: 'javascript' }, properties: { a: {} } }],
    })
    expect(flattened.title).toBe('Config')
    expect(flattened['x-doc']).toEqual({ language: 'javascript' })
  })

  it('keeps the root title and docs config over a branch one', () => {
    const flattened = flattenRoot({
      title: 'Root',
      'x-doc': { language: 'yaml' },
      anyOf: [{ title: 'Branch', 'x-doc': { language: 'javascript' }, properties: { a: {} } }],
    })
    expect(flattened.title).toBe('Root')
    expect(flattened['x-doc']).toEqual({ language: 'yaml' })
  })

  it('ignores branches that declare no properties', () => {
    const schema = { anyOf: [{ type: 'string' }, { type: 'null' }] }
    expect(flattenRoot(schema)).toBe(schema)
  })

  it('returns an empty schema unchanged', () => {
    expect(flattenRoot({})).toEqual({})
  })
})
