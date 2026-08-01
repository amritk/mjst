import { describe, expect, it } from 'vitest'

import { assertGeneratableRefs } from './assert-generatable-refs'

describe('assert-generatable-refs', () => {
  it('allows in-document pointers and anchors', () => {
    expect(() =>
      assertGeneratableRefs({ properties: { a: { $ref: '#/$defs/contact' }, b: { $ref: '#contact' } } }, 'Doc'),
    ).not.toThrow()
  })

  it('allows an absolute http(s) ref, which the walker keys into $defs', () => {
    expect(() => assertGeneratableRefs({ $ref: 'https://example.com/contact.json' }, 'Doc')).not.toThrow()
  })

  it.each([
    ['int.json'],
    ['node'],
    ['/absref/foobar.json'],
    ['nested/foo.json'],
    ['urn:uuid:deadbeef-1234-ffff-ffff-4321feebdaed'],
    ['child1#my_anchor'],
  ])('refuses %s, which only resolves through an enclosing $id', (ref) => {
    // The walker never queues these, so no file is generated for them — but the
    // emitter reads only the ref string and would still write the call.
    expect(() => assertGeneratableRefs({ $ref: ref }, 'Doc')).toThrow(ref)
  })

  it('finds a ref nested anywhere the emitter would delegate from', () => {
    // The traversal has to cover every applicator the emitter recurses into, or a
    // ref slips past the check and reappears as an undefined function.
    for (const schema of [
      { properties: { a: { items: { $ref: 'int.json' } } } },
      { allOf: [{ patternProperties: { '^x-': { $ref: 'int.json' } } }] },
      { if: { $ref: 'int.json' } },
      { dependentSchemas: { a: { $ref: 'int.json' } } },
      { prefixItems: [{ not: { $ref: 'int.json' } }] },
    ]) {
      expect(() => assertGeneratableRefs(schema, 'Doc'), JSON.stringify(schema)).toThrow('int.json')
    }
  })

  it('ignores refs inside $defs, which are generated as their own files', () => {
    expect(() => assertGeneratableRefs({ $defs: { a: { $ref: 'int.json' } } }, 'Doc')).not.toThrow()
  })
})
