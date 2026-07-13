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

  it('reports an unresolvable internal pointer instead of inlining undefined', () => {
    const { resolved, errors } = resolveRefs({
      properties: { a: { $ref: '#/$defs/missing' } },
    })

    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toMatch(/Cannot resolve internal \$ref/)
    // The original $ref node is preserved rather than replaced with `undefined`.
    expect((resolved as { properties: { a: unknown } }).properties.a).toEqual({ $ref: '#/$defs/missing' })
  })

  it('breaks a self-referential cycle by keeping the reference', () => {
    const { resolved, errors } = resolveRefs({
      $defs: { node: { type: 'object', properties: { next: { $ref: '#/$defs/node' } } } },
      properties: { head: { $ref: '#/$defs/node' } },
    })

    expect(errors).toEqual([])
    const head = (resolved as { properties: { head: { properties: { next: unknown } } } }).properties.head
    // The first level resolves; the recursive self-reference keeps its `$ref`,
    // which still resolves within the output (`$defs.node` is preserved), so
    // the recursive branch survives instead of collapsing to `{}`.
    expect(head.properties.next).toEqual({ $ref: '#/$defs/node' })
  })

  it('breaks a mutual cycle (A → B → A) without infinite recursion', () => {
    const { resolved } = resolveRefs({
      $defs: {
        a: { type: 'object', properties: { b: { $ref: '#/$defs/b' } } },
        b: { type: 'object', properties: { a: { $ref: '#/$defs/a' } } },
      },
      properties: { root: { $ref: '#/$defs/a' } },
    })

    // Resolution terminates; whichever leg re-enters the cycle first keeps its
    // `$ref` rather than looping forever — and that ref still resolves against
    // the preserved `$defs`, so no information is lost.
    const root = (resolved as { properties: { root: { type: string; properties: { b: unknown } } } }).properties.root
    expect(root.type).toBe('object')
    expect(root.properties.b).toEqual({ $ref: '#/$defs/b' })
    // The kept ref's target survives in the output with its full shape.
    const defs = (resolved as { $defs: { b: { type: string; properties: { a: unknown } } } }).$defs
    expect(defs.b.type).toBe('object')
  })

  it('leaves external (non-#) refs untouched', () => {
    const { resolved } = resolveRefs({ properties: { pet: { $ref: 'pet.json#/Pet' } } })

    expect(resolved).toEqual({ properties: { pet: { $ref: 'pet.json#/Pet' } } })
  })

  it('omits the origin map unless trackOrigins is set', () => {
    const result = resolveRefs({ a: { $ref: '#/$defs/x' }, $defs: { x: { type: 'string' } } })
    expect(result.origins).toBeUndefined()
  })

  it('stamps each inlined node with its in-document origin path', () => {
    const { resolved, origins } = resolveRefs(
      {
        properties: { a: { $ref: '#/$defs/x' }, b: { $ref: '#/$defs/x' } },
        $defs: { x: { type: 'object', properties: { id: { type: 'string' } } } },
      },
      { trackOrigins: true },
    )
    const tree = resolved as { properties: { a: object; b: object } }
    // Repeated refs share one object, stamped once with the definition path.
    expect(tree.properties.a).toBe(tree.properties.b)
    expect(origins?.get(tree.properties.a)).toEqual({ location: '', pointer: ['$defs', 'x'] })
  })

  it('keeps keywords sibling to a $ref by combining them in an allOf', () => {
    // JSON Schema 2020-12 applies `$ref` siblings alongside the referenced
    // schema, so inlining must not drop them.
    const { resolved } = resolveRefs({
      properties: { p: { $ref: '#/$defs/s', maxLength: 2 } },
      $defs: { s: { type: 'string' } },
    })
    expect((resolved as { properties: { p: unknown } }).properties.p).toEqual({
      maxLength: 2,
      allOf: [{ type: 'string' }],
    })
  })

  it('merges $ref siblings into an existing allOf rather than overwriting it', () => {
    const { resolved } = resolveRefs({
      root: { $ref: '#/$defs/s', allOf: [{ minLength: 1 }] },
      $defs: { s: { type: 'string' } },
    })
    expect((resolved as { root: unknown }).root).toEqual({
      allOf: [{ minLength: 1 }, { type: 'string' }],
    })
  })

  it('stamps the origin of a $ref-with-siblings wrapper node', () => {
    const { resolved, origins } = resolveRefs(
      {
        properties: { p: { $ref: '#/$defs/s', maxLength: 2 } },
        $defs: { s: { type: 'string' } },
      },
      { trackOrigins: true },
    )
    const node = (resolved as { properties: { p: object } }).properties.p
    expect(origins?.get(node)).toEqual({ location: '', pointer: ['$defs', 's'] })
  })

  it('leaves a $ref with no siblings inlined directly', () => {
    const { resolved } = resolveRefs({
      a: { $ref: '#/$defs/s' },
      $defs: { s: { type: 'string' } },
    })
    expect((resolved as { a: unknown }).a).toEqual({ type: 'string' })
  })

  it('decodes pointer escapes and array indices in origin paths', () => {
    const { resolved, origins } = resolveRefs(
      { ref: { $ref: '#/a~1b/c~0d/0' }, 'a/b': { 'c~d': [{ type: 'number' }] } },
      { trackOrigins: true },
    )
    const node = (resolved as { ref: object }).ref
    expect(origins?.get(node)).toEqual({ location: '', pointer: ['a/b', 'c~d', 0] })
  })
})
