import { describe, expect, it } from 'vitest'
import { flattenRoot } from '#reference/flatten-root'

describe('flatten-root', () => {
  it('leaves a plain object schema alone', () => {
    const schema = { properties: { a: { type: 'string' } }, required: ['a'] }
    expect(flattenRoot(schema)).toBe(schema)
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
  // still valid, so calling the property required would be a lie.
  it('marks a property required only when every branch declaring it requires it', () => {
    const flattened = flattenRoot({
      anyOf: [
        { properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a', 'b'] },
        { properties: { a: { type: 'string' } }, required: ['a'] },
      ],
    })
    expect(flattened.required).toEqual(['a', 'b'])
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
