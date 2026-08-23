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

  // A pipe inside a quoted literal is part of the value; split on it, the
  // dedupe swallows one of the halves. Both dialects quote, so both need
  // protecting.
  it('does not split a union member that carries its own pipe', () => {
    expect(referenceType({ enum: [' | ', 'z'] }, 'json')).toBe('" | " | "z"')
    expect(referenceType({ enum: ['a | b', 'a | c'] }, 'javascript')).toBe("'a | b' | 'a | c'")
  })

  // A bracketed member is one type however many pipes it holds — an authored
  // `x-doc.type` is the usual way one arrives.
  it('does not split a bracketed member', () => {
    expect(referenceType({ anyOf: [{ 'x-doc': { type: '(a | b)' } }, { 'x-doc': { type: '[c | d]' } }] }, 'json')).toBe(
      '(a | b) | [c | d]',
    )
  })

  // A branch with nothing to say contributes nothing, not a blank member with
  // a separator on each side.
  it('drops a branch that has no label at all', () => {
    expect(referenceType({ anyOf: [{}, { type: 'string' }] }, 'json')).toBe('string')
  })

  // The guard against a self-referential stub, at its edge: eight levels of
  // array still name their element, the ninth gives up.
  it('gives up on a label exactly as deep as it says it will', () => {
    const arrays = (levels: number): Record<string, unknown> =>
      levels === 0 ? { type: 'string' } : { type: 'array', items: arrays(levels - 1) }
    expect(referenceType(arrays(8), 'json')).toBe('string[][][][][][][][]')
    expect(referenceType(arrays(9), 'json')).toBe('array[][][][][][][][]')
  })

  // `&` binds tighter than the `|` beside it, so an intersection branch that is
  // itself a union needs brackets or the label collapses back to a union.
  it('brackets a union inside an intersection', () => {
    expect(
      referenceType({ allOf: [{ anyOf: [{ type: 'string' }, { type: 'number' }] }, { type: 'string' }] }, 'json'),
    ).toBe('(string | number) & string')
    expect(referenceType({ allOf: [{ enum: ['a', 'b'] }, { enum: ['b', 'c'] }] }, 'json')).toBe(
      '("a" | "b") & ("b" | "c")',
    )
  })

  // A branch with nothing to say contributes nothing to an intersection either,
  // not a blank operand with a separator hanging off it.
  it('drops an intersection branch that has no label', () => {
    expect(referenceType({ allOf: [{ type: 'string' }, {}] }, 'json')).toBe('string')
  })

  // A node with both keywords reads `anyOf` first, the same order every other
  // reader of this schema uses.
  it('reads anyOf before oneOf', () => {
    expect(referenceType({ anyOf: [{ type: 'string' }], oneOf: [{ type: 'number' }] }, 'json')).toBe('string')
  })

  // A part that is already bracketed is one type, and a quoted literal that
  // holds a pipe is one value — bracketing either spells it as a group.
  it('brackets only a branch that is a union at its top level', () => {
    const arrayOfUnion = { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }] } }
    expect(referenceType({ allOf: [arrayOfUnion, { type: 'object' }] }, 'json')).toBe('(string | number)[] & object')
    expect(referenceType({ allOf: [{ const: 'a | b' }, { type: 'string' }] }, 'json')).toBe('"a | b" & string')
    // The same rule for an array's element: a literal holding a pipe is one
    // value, and bracketing it spells it as a group of two.
    expect(referenceType({ type: 'array', items: { const: 'a | b' } }, 'json')).toBe('"a | b"[]')
  })

  // `Alpha & Beta[]` is an intersection with an array, not an array of one.
  it('brackets an intersection used as an array element', () => {
    const items = { allOf: [{ 'x-doc': { type: 'Alpha' } }, { 'x-doc': { type: 'Beta' } }] }
    expect(referenceType({ type: 'array', items }, 'json')).toBe('(Alpha & Beta)[]')
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
