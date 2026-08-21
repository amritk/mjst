import { describe, expect, it } from 'vitest'
import { referenceType, typeShowsEnum } from '#helpers/reference-type'

describe('reference-type', () => {
  it('uses the declared type', () => {
    expect(referenceType({ type: 'string' }, 'json')).toBe('string')
  })

  // The allowed values *are* the type a reader needs, so the label spells them
  // out rather than flattening them to `string`.
  it('renders an enum as a literal union', () => {
    expect(referenceType({ enum: ['json', 'yaml', 'both'] }, 'javascript')).toBe("'json' | 'yaml' | 'both'")
    expect(referenceType({ enum: ['json', 'yaml'] }, 'json')).toBe('"json" | "yaml"')
  })

  it('renders a mixed enum without repeating a value', () => {
    expect(referenceType({ enum: [1, 'a', 1] }, 'json')).toBe('1 | "a"')
  })

  it('renders a const as its literal', () => {
    expect(referenceType({ const: 3 }, 'json')).toBe('3')
  })

  it('renders a typed array as `item[]`', () => {
    expect(referenceType({ type: 'array', items: { type: 'string' } }, 'json')).toBe('string[]')
  })

  // `string | number[]` would read as "a string, or an array of numbers".
  it('brackets a union item type', () => {
    expect(referenceType({ type: 'array', items: { type: ['string', 'number'] } }, 'json')).toBe('(string | number)[]')
  })

  it('falls back to `array` when the item type is unknown', () => {
    expect(referenceType({ type: 'array' }, 'json')).toBe('array')
    expect(referenceType({ type: 'array', items: {} }, 'json')).toBe('array')
  })

  it('renders a type array as a union', () => {
    expect(referenceType({ type: ['string', 'null'] }, 'json')).toBe('string | null')
  })

  it('unions the branches of anyOf', () => {
    expect(referenceType({ anyOf: [{ type: 'string' }, { type: 'number' }] }, 'json')).toBe('string | number')
  })

  it('infers `object` from properties alone', () => {
    expect(referenceType({ properties: { a: { type: 'string' } } }, 'json')).toBe('object')
  })

  it('says nothing when the schema says nothing', () => {
    expect(referenceType({}, 'json')).toBe('')
  })

  // Plenty of real config types — a callback signature, a named TypeScript
  // type — have no JSON Schema spelling at all.
  it('lets x-doc.type override everything', () => {
    const prop = { type: 'object', enum: ['a'], 'x-doc': { type: 'AuthenticationConfiguration' } }
    expect(referenceType(prop, 'json')).toBe('AuthenticationConfiguration')
  })

  it('reports whether the type label already lists the enum', () => {
    expect(typeShowsEnum({ enum: ['a', 'b'] })).toBe(true)
    expect(typeShowsEnum({ enum: ['a', 'b'], 'x-doc': { type: 'Mode' } })).toBe(false)
    expect(typeShowsEnum({ type: 'string' })).toBe(false)
  })

  it('survives a self-referential stub without recursing forever', () => {
    const recursive: Record<string, unknown> = { type: 'array' }
    recursive['items'] = recursive
    expect(() => referenceType(recursive, 'json')).not.toThrow()
  })
})
