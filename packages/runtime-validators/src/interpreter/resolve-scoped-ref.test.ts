import { describe, expect, it } from 'vitest'

import { resolveScopedDynamicRef, resolveScopedRef } from './resolve-scoped-ref'
import { buildSchemaRegistry, type SchemaRegistry } from './schema-registry'

/** Builds the registry for a document we know declares an `$id`. */
const registryFor = (root: unknown): SchemaRegistry => buildSchemaRegistry(root) as SchemaRegistry

describe('resolve-scoped-ref', () => {
  it('resolves a relative ref against the base in scope', () => {
    const root = {
      $id: 'https://example.com/draft/base.json',
      $ref: 'int.json',
      $defs: { bigint: { $id: 'int.json', maximum: 10 } },
    }
    const registry = registryFor(root)

    expect(resolveScopedRef(registry, 'int.json', registry.rootBase)?.value).toBe(root.$defs.bigint)
  })

  it('resolves an absolute-path ref against the base authority', () => {
    const root = {
      $id: 'http://example.com/ref/absref.json',
      $defs: {
        a: { $id: 'http://example.com/ref/absref/foobar.json', type: 'number' },
        b: { $id: 'http://example.com/absref/foobar.json', type: 'string' },
      },
      $ref: '/absref/foobar.json',
    }
    const registry = registryFor(root)

    expect(resolveScopedRef(registry, '/absref/foobar.json', registry.rootBase)?.value).toBe(root.$defs.b)
  })

  it('applies a pointer fragment inside the resource the URI names', () => {
    const root = {
      $id: 'http://example.com/outer.json',
      properties: {
        foo: { $id: 'inner.json', $defs: { inner: { type: 'string' } }, $ref: '#/$defs/inner' },
      },
      $defs: { inner: { type: 'number' } },
    }
    const registry = registryFor(root)

    // The same `#/$defs/inner` means two different things depending on which
    // resource it is written in — that is the whole point of `$id` scoping.
    const fromInner = resolveScopedRef(registry, '#/$defs/inner', 'http://example.com/inner.json')
    expect(fromInner?.value).toBe(root.properties.foo.$defs.inner)
    expect(resolveScopedRef(registry, '#/$defs/inner', registry.rootBase)?.value).toBe(root.$defs.inner)
  })

  it('reports the base a pointer walked into, not the one it started from', () => {
    const root = {
      $id: 'https://example.com/base',
      $defs: { first: { $id: 'first', $defs: { stuff: { $id: 'stuff', type: 'string' } } } },
    }
    const registry = registryFor(root)

    // Refs written inside the target resolve against `stuff`, so that is the base
    // the caller has to carry forward.
    expect(resolveScopedRef(registry, 'first#/$defs/stuff', registry.rootBase)?.base).toBe('https://example.com/stuff')
  })

  it('resolves an anchor within the resource that declares it', () => {
    const root = {
      $id: 'http://localhost:1234/root',
      $ref: 'nested.json#foo',
      $defs: { A: { $id: 'nested.json', $defs: { B: { $anchor: 'foo', type: 'integer' } } } },
    }
    const registry = registryFor(root)

    expect(resolveScopedRef(registry, 'nested.json#foo', registry.rootBase)?.value).toBe(root.$defs.A.$defs.B)
  })

  it('returns undefined for a URI that names no resource in this document', () => {
    // The caller answers this by falling back to a document-global search and
    // then by failing loudly — it never guesses, and it never fetches.
    const registry = registryFor({ $id: 'https://example.com/root', type: 'object' })

    expect(resolveScopedRef(registry, 'https://example.com/elsewhere.json', registry.rootBase)).toBeUndefined()
  })

  it('binds a $dynamicRef to the outermost matching $dynamicAnchor in the dynamic scope', () => {
    const root = {
      $id: 'https://example.com/root',
      $ref: 'list',
      $defs: {
        foo: { $dynamicAnchor: 'items', type: 'string' },
        list: {
          $id: 'list',
          items: { $dynamicRef: '#items' },
          $defs: { items: { $dynamicAnchor: 'items' } },
        },
      },
    }
    const registry = registryFor(root)
    const scope = ['https://example.com/root', 'https://example.com/list']

    // Statically `#items` names the bookend inside `list`; through the dynamic
    // scope it resolves to the root's, which is what makes generic schemas
    // extensible.
    expect(resolveScopedDynamicRef(registry, '#items', 'https://example.com/list', scope)?.value).toBe(root.$defs.foo)
  })

  it('behaves like $ref when the statically resolved target is not a $dynamicAnchor', () => {
    // Without that bookend the reference must stay put, even though an outer
    // resource declares a `$dynamicAnchor` of the same name.
    const root = {
      $id: 'https://example.com/root',
      $defs: {
        foo: { $dynamicAnchor: 'items', type: 'string' },
        list: { $id: 'list', $defs: { items: { $anchor: 'items' } } },
      },
    }
    const registry = registryFor(root)
    const scope = ['https://example.com/root', 'https://example.com/list']

    expect(resolveScopedDynamicRef(registry, '#items', 'https://example.com/list', scope)?.value).toBe(
      root.$defs.list.$defs.items,
    )
  })

  it('ignores a resource that is not in the dynamic scope', () => {
    const root = {
      $id: 'https://example.com/main',
      $defs: {
        skipped: { $id: 'skipped', $dynamicAnchor: 'content', type: 'string' },
        item: { $id: 'item', $defs: { fallback: { $dynamicAnchor: 'content', type: 'integer' } } },
      },
    }
    const registry = registryFor(root)

    // `skipped` declares the anchor, but evaluation never entered it.
    expect(
      resolveScopedDynamicRef(registry, '#content', 'https://example.com/item', [
        'https://example.com/main',
        'https://example.com/item',
      ])?.value,
    ).toBe(root.$defs.item.$defs.fallback)
  })

  it('treats a pointer fragment on a $dynamicRef as a plain $ref', () => {
    const root = {
      $id: 'https://example.com/root',
      $defs: { foo: { $dynamicAnchor: 'items', type: 'string' }, items: { type: 'number' } },
    }
    const registry = registryFor(root)

    expect(resolveScopedDynamicRef(registry, '#/$defs/items', registry.rootBase, [registry.rootBase])?.value).toBe(
      root.$defs.items,
    )
  })
})
