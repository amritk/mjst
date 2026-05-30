import { describe, expect, it } from 'vitest'

import { resolveRefs } from './resolve-refs'

describe('resolve-refs', () => {
  it('inlines an internal $ref', () => {
    const { resolved, errors } = resolveRefs({
      type: 'object',
      properties: { contact: { $ref: '#/$defs/contact' } },
      $defs: { contact: { type: 'string' } },
    })

    expect(errors).toEqual([])
    expect(resolved).toMatchObject({ properties: { contact: { type: 'string' } } })
  })

  it('breaks a self-referential cycle with an empty object', () => {
    const { resolved } = resolveRefs({
      $defs: { node: { type: 'object', properties: { next: { $ref: '#/$defs/node' } } } },
      properties: { head: { $ref: '#/$defs/node' } },
    })

    const head = (resolved as { properties: { head: { properties: { next: unknown } } } }).properties.head
    // The first level resolves; the recursive self-reference terminates at `{}`.
    expect(head.properties.next).toEqual({})
  })

  it('breaks a mutual cycle (A → B → A) without infinite recursion', () => {
    const { resolved } = resolveRefs({
      $defs: {
        a: { type: 'object', properties: { b: { $ref: '#/$defs/b' } } },
        b: { type: 'object', properties: { a: { $ref: '#/$defs/a' } } },
      },
      properties: { root: { $ref: '#/$defs/a' } },
    })

    // Resolution terminates; `a` is in the cache by the time `properties.root` is
    // processed, so we get the partially-resolved shape where the back-reference
    // leg terminated at `{}` rather than looping forever.
    const root = (resolved as { properties: { root: { type: string; properties: { b: unknown } } } }).properties.root
    expect(root.type).toBe('object')
    expect(root.properties.b).toEqual({})
  })

  it('leaves external (non-#) refs untouched', () => {
    const { resolved } = resolveRefs({ properties: { pet: { $ref: 'pet.json#/Pet' } } })

    expect(resolved).toEqual({ properties: { pet: { $ref: 'pet.json#/Pet' } } })
  })
})
