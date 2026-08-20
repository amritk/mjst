import { describe, expect, it } from 'vitest'

import { collectReferencedPointers } from './ref-index'

describe('ref-index', () => {
  it('indexes a `$ref` target and every ancestor of it', () => {
    const index = collectReferencedPointers({ a: { $ref: '#/components/schemas/Pet/properties/id' } })
    // The exact target, and each ancestor, so a ref reaching *into* an object
    // still counts as a use of that object.
    expect(index.has('#/components/schemas/Pet/properties/id')).toBe(true)
    expect(index.has('#/components/schemas/Pet')).toBe(true)
    expect(index.has('#/components/schemas')).toBe(true)
    // A sibling that merely shares a prefix is not a use.
    expect(index.has('#/components/schemas/Person')).toBe(false)
  })

  it('finds refs nested in arrays and ignores non-string ones', () => {
    const index = collectReferencedPointers({
      list: [{ $ref: '#/definitions/A' }, { nested: [{ $ref: './other.yaml#/definitions/B' }] }],
      bogus: { $ref: 42 },
    })
    expect(index.has('#/definitions/A')).toBe(true)
    expect(index.has('./other.yaml#/definitions/B')).toBe(true)
    // An external ref is not a use of the same-named local definition.
    expect(index.has('#/definitions/B')).toBe(false)
  })

  it('walks a deeply nested document without overflowing the stack', () => {
    // Document depth is attacker-controlled, so the walk keeps its own stack.
    let node: unknown = { $ref: '#/deep' }
    for (let i = 0; i < 50_000; i++) node = { child: node }
    expect(collectReferencedPointers(node).has('#/deep')).toBe(true)
  })
})
