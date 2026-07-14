import { describe, expect, it } from 'vitest'

import { resolveRefs } from './resolve-refs'

// The in-memory resolver exercises the shared fragment logic in `reference.ts`;
// the from-file resolver reuses it, so covering it here covers both paths for the
// keyword semantics (the from-file suite adds the cross-document cases).
describe('anchors and dynamic references', () => {
  it('resolves a $ref to a plain-name $anchor', () => {
    const { resolved, errors } = resolveRefs({
      properties: { node: { $ref: '#node' } },
      $defs: { node: { $anchor: 'node', type: 'string' } },
    })
    expect(errors).toEqual([])
    expect((resolved as { properties: { node: unknown } }).properties.node).toEqual({
      $anchor: 'node',
      type: 'string',
    })
  })

  it('resolves a $ref to a $dynamicAnchor by plain name', () => {
    const { resolved } = resolveRefs({
      properties: { m: { $ref: '#meta' } },
      $defs: { meta: { $dynamicAnchor: 'meta', type: 'object' } },
    })
    expect((resolved as { properties: { m: { type: string } } }).properties.m.type).toBe('object')
  })

  it('binds $dynamicRef to a $dynamicAnchor of the same name', () => {
    const { resolved, errors } = resolveRefs({
      items: { $dynamicRef: '#items' },
      $defs: { node: { $dynamicAnchor: 'items', type: 'array' } },
    })
    expect(errors).toEqual([])
    expect((resolved as { items: { type: string } }).items.type).toBe('array')
  })

  it('falls back to a plain $anchor when a $dynamicRef has no matching $dynamicAnchor', () => {
    const { resolved } = resolveRefs({
      a: { $dynamicRef: '#plain' },
      $defs: { x: { $anchor: 'plain', type: 'boolean' } },
    })
    expect((resolved as { a: { type: string } }).a.type).toBe('boolean')
  })

  it('resolves a $dynamicRef written as a JSON pointer like an ordinary $ref', () => {
    const { resolved } = resolveRefs({
      a: { $dynamicRef: '#/$defs/s' },
      $defs: { s: { type: 'string' } },
    })
    expect((resolved as { a: unknown }).a).toEqual({ type: 'string' })
  })

  it('binds $recursiveRef "#" to the node carrying $recursiveAnchor: true', () => {
    const { resolved } = resolveRefs({
      $recursiveAnchor: true,
      type: 'object',
      properties: { child: { $recursiveRef: '#' } },
    })
    // The recursive anchor is the root, so `child` inlines a copy of the root
    // schema one level deep; the cycle guard then keeps the reference at the
    // next level, keeping the tree finite without losing the recursion.
    const child = (resolved as { properties: { child: { type: string; properties: { child: unknown } } } }).properties
      .child
    expect(child.type).toBe('object')
    expect(child.properties.child).toEqual({ $recursiveRef: '#' })
  })

  it('falls back to the document root when $recursiveRef finds no $recursiveAnchor', () => {
    const { resolved, errors } = resolveRefs({
      type: 'object',
      properties: { child: { $recursiveRef: '#' } },
    })
    expect(errors).toEqual([])
    // No $recursiveAnchor, so it binds to the whole document — the same finite
    // one-level unrolling as the anchored case.
    const child = (resolved as { properties: { child: { type: string; properties: { child: unknown } } } }).properties
      .child
    expect(child.type).toBe('object')
    expect(child.properties.child).toEqual({ $recursiveRef: '#' })
  })

  it('terminates on a self-referential schema reached through a $dynamicAnchor', () => {
    const { resolved } = resolveRefs({
      type: 'object',
      properties: { root: { $ref: '#/$defs/tree' } },
      $defs: {
        tree: {
          $dynamicAnchor: 'tree',
          type: 'array',
          items: { $dynamicRef: '#tree' },
        },
      },
    })
    const root = (resolved as { properties: { root: { type: string; items: { type: string; items: unknown } } } })
      .properties.root
    expect(root.type).toBe('array')
    // One level of recursion is inlined, then the cycle guard keeps the ref.
    expect(root.items.type).toBe('array')
    expect(root.items.items).toEqual({ $dynamicRef: '#tree' })
  })

  it('reports a missing anchor and keeps the original reference node', () => {
    const { resolved, errors } = resolveRefs({
      a: { $ref: '#nope' },
      $defs: {},
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toMatch(/Cannot resolve internal \$ref "#nope"/)
    expect((resolved as { a: unknown }).a).toEqual({ $ref: '#nope' })
  })

  it('reports a missing anchor once even when referenced repeatedly', () => {
    const { errors } = resolveRefs({
      a: { $ref: '#gone' },
      b: { $ref: '#gone' },
    })
    expect(errors).toHaveLength(1)
  })

  it('inlines an annotation-only sibling (description) as an override, not an allOf', () => {
    // `summary`/`description` are the only siblings OpenAPI 3.1 Reference
    // Objects allow, and they override the target's — no `allOf` wrapper.
    const { resolved } = resolveRefs({
      a: { $dynamicRef: '#base', description: 'local' },
      $defs: { base: { $dynamicAnchor: 'base', type: 'object', description: 'from target' } },
    })
    expect((resolved as { a: unknown }).a).toEqual({
      $dynamicAnchor: 'base',
      type: 'object',
      description: 'local',
    })
  })

  it('still combines constraint-carrying siblings of a $dynamicRef via allOf', () => {
    const { resolved } = resolveRefs({
      a: { $dynamicRef: '#base', minProperties: 1 },
      $defs: { base: { $dynamicAnchor: 'base', type: 'object' } },
    })
    expect(resolved as { a: unknown }).toMatchObject({
      a: { minProperties: 1, allOf: [{ type: 'object' }] },
    })
  })
})
