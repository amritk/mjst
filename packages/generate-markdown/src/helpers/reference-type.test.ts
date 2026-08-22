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

  // A tuple names a different shape per position, and the label is the first
  // position's — reading a later one described the wrong element.
  it('labels a tuple array by its first position', () => {
    expect(referenceType({ type: 'array', items: [{ type: 'string' }, { type: 'number' }] }, 'json')).toBe('string[]')
  })

  // `const` is one allowed value, so it is read the same way `enum` is — and
  // before either type keyword, because a `const` of `"a"` says more than
  // `string` does.
  it('reads a const before the type it belongs to', () => {
    expect(referenceType({ type: 'string', const: 'a' }, 'json')).toBe('"a"')
    expect(referenceType({ type: 'string', enum: ['a'], const: 'b' }, 'json')).toBe('"a"')
  })

  // `allOf` is an intersection, not an alternative, but a `$ref` to a scalar
  // wrapped in one is the only thing that says what the property is.
  it('falls back to the allOf branches for a label', () => {
    // An `enum`, so the fallback table renderer's own label (`string`) cannot
    // stand in for the answer.
    expect(referenceType({ allOf: [{ enum: ['x'] }] }, 'json')).toBe('"x"')
    // The alternatives come first: a node with both is a union of the two
    // spellings, and `anyOf` is the one that names them.
    expect(referenceType({ anyOf: [{ type: 'number' }], allOf: [{ type: 'string' }] }, 'json')).toBe('number')
  })

  // A union of a union printed the same word twice.
  it('flattens a nested union into one list', () => {
    const prop = { anyOf: [{ anyOf: [{ type: 'object' }, { type: 'string' }] }, { type: 'object' }] }
    expect(referenceType(prop, 'json')).toBe('object | string')
  })

  // Two things a part may hold that a naive split would take apart: an array
  // whose item is a union, and an enum literal with a pipe in it.
  it('does not take a bracketed item or a quoted literal apart', () => {
    const array = { anyOf: [{ type: 'array', items: { type: ['string', 'number'] } }, { type: 'null' }] }
    expect(referenceType(array, 'json')).toBe('(string | number)[] | null')
    expect(referenceType({ enum: ['a | b'] }, 'json')).toBe('"a | b"')
  })

  it('survives a self-referential stub without recursing forever', () => {
    const recursive: Record<string, unknown> = { type: 'array' }
    recursive['items'] = recursive
    expect(() => referenceType(recursive, 'json')).not.toThrow()
  })
})
