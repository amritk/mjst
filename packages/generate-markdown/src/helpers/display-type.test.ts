import { describe, expect, it } from 'vitest'
import { displayType, jsonTypeOf, unionOf } from '#helpers/display-type'

describe('display-type', () => {
  it('names the JSON type a value has', () => {
    // `typeof null` is `'object'` and `typeof []` is `'object'`, so both need
    // saying before the fallback gets a chance.
    expect(jsonTypeOf(null)).toBe('null')
    expect(jsonTypeOf([1])).toBe('array')
    expect(jsonTypeOf({})).toBe('object')
    expect(jsonTypeOf('a')).toBe('string')
    expect(jsonTypeOf(1)).toBe('number')
    expect(jsonTypeOf(true)).toBe('boolean')
  })

  it('joins a union without blanks or repeats', () => {
    expect(unionOf(['string', '', 'string', 'number'])).toBe('string | number')
  })

  it('shows a declared type verbatim', () => {
    expect(displayType({ type: 'string' })).toBe('string')
    // A declared `["string","null"]` keeps its `null` — the author said it.
    expect(displayType({ type: ['string', 'null'] })).toBe('string | null')
  })

  it('infers a label from the values a property allows', () => {
    expect(displayType({ enum: ['a', 1] })).toBe('string | number')
    expect(displayType({ const: null })).toBe('null')
  })

  // The branch that exists only to allow null is noise next to the real shape,
  // and keeping it labelled half the properties in a generated schema
  // `object | null`.
  it('drops a null-only branch from an inferred union', () => {
    expect(displayType({ anyOf: [{ type: 'object' }, { type: 'null' }] })).toBe('object')
    expect(displayType({ anyOf: [{ type: 'object' }, { type: 'string' }] })).toBe('object | string')
  })

  // The shape a property implies, when it never says it outright.
  it('falls back to the shape the keywords imply', () => {
    expect(displayType({ properties: { a: {} } })).toBe('object')
    expect(displayType({ items: { type: 'string' } })).toBe('array')
    expect(displayType({})).toBe('')
  })

  // The keywords are read in the order a reader meets them, and `allOf` is
  // read at all — a `$ref` wrapped in one is often the only thing that says
  // what a property is.
  it('reads every composition keyword, alternatives first', () => {
    expect(displayType({ allOf: [{ type: 'string' }] })).toBe('string')
    expect(displayType({ anyOf: [{ type: 'string' }], oneOf: [{ type: 'number' }] })).toBe('string')
  })

  // `enum` before `const`, the same order the prose label reads them in.
  it('prefers the enum to the const when a node declares both', () => {
    expect(displayType({ enum: ['a'], const: 1 })).toBe('string')
  })

  // A `type` array is parsed JSON: an entry that is not a string is not a type.
  it('ignores an entry in a type array that is not a name', () => {
    expect(displayType({ type: ['string', 5, null] as never })).toBe('string')
  })
})
