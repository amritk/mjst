import { describe, expect, it } from 'vitest'

import { buildSchemaRegistry, SYNTHETIC_BASE } from './schema-registry'

describe('schema-registry', () => {
  it('returns null for a document that declares no $id', () => {
    // This null is the interpreter's switch for the whole base-URI apparatus, so
    // it matters that an ordinary schema never trips it.
    expect(buildSchemaRegistry({ type: 'object', $defs: { a: { $anchor: 'a' } } })).toBeNull()
    expect(buildSchemaRegistry(true)).toBeNull()
  })

  it('registers the root under its own $id', () => {
    const root = { $id: 'https://example.com/schema.json', type: 'object' }
    const registry = buildSchemaRegistry(root)

    expect(registry?.rootBase).toBe('https://example.com/schema.json')
    expect(registry?.resources.get('https://example.com/schema.json')).toBe(root)
    // The synthetic base resolves to the root too, so an in-memory document with
    // an `$id` still answers a plain `#/...` self-reference.
    expect(registry?.resources.get(SYNTHETIC_BASE)).toBe(root)
  })

  it('resolves a nested $id against the base of its nearest parent', () => {
    const root = {
      $id: 'http://example.com/a.json',
      $defs: {
        x: {
          $id: 'http://example.com/b/c.json',
          not: { $defs: { y: { $id: 'd.json', type: 'number' } } },
        },
      },
    }
    const registry = buildSchemaRegistry(root)

    // `d.json` composes against `http://example.com/b/c.json`, not against the
    // document root — the difference between `/b/d.json` and `/d.json`.
    expect(registry?.resources.get('http://example.com/b/d.json')).toBe(root.$defs.x.not.$defs.y)
  })

  it('scopes anchors to the resource that declares them', () => {
    const root = {
      $id: 'http://localhost:1234/foobar',
      $defs: {
        A: {
          $id: 'child1',
          allOf: [
            { $id: 'child2', $anchor: 'my_anchor', type: 'number' },
            { $anchor: 'my_anchor', type: 'string' },
          ],
        },
      },
    }
    const registry = buildSchemaRegistry(root)

    expect(registry?.anchors.get('http://localhost:1234/child1#my_anchor')).toBe(root.$defs.A.allOf[1])
    expect(registry?.anchors.get('http://localhost:1234/child2#my_anchor')).toBe(root.$defs.A.allOf[0])
  })

  it('records a $dynamicAnchor as both a dynamic and an ordinary anchor', () => {
    const root = { $id: 'https://example.com/root', $defs: { a: { $dynamicAnchor: 'items' } } }
    const registry = buildSchemaRegistry(root)

    expect(registry?.dynamicAnchors.get('https://example.com/root#items')).toBe(root.$defs.a)
    expect(registry?.anchors.get('https://example.com/root#items')).toBe(root.$defs.a)
  })

  it('leaves a plain $anchor out of the dynamic anchors', () => {
    // `$dynamicRef` must not bind to a plain `$anchor` of the same name.
    const root = { $id: 'https://example.com/root', $defs: { a: { $anchor: 'items' } } }
    const registry = buildSchemaRegistry(root)

    expect(registry?.dynamicAnchors.get('https://example.com/root#items')).toBeUndefined()
  })

  it('supports a URN $id', () => {
    const root = { $id: 'urn:uuid:deadbeef-1234-ffff-ffff-4321feebdaed', $defs: { bar: { $anchor: 'x' } } }
    const registry = buildSchemaRegistry(root)

    expect(registry?.resources.get('urn:uuid:deadbeef-1234-ffff-ffff-4321feebdaed')).toBe(root)
    expect(registry?.anchors.get('urn:uuid:deadbeef-1234-ffff-ffff-4321feebdaed#x')).toBe(root.$defs.bar)
  })

  it('ignores an $id sitting inside instance data', () => {
    // A schema is allowed to describe an object that happens to have an `$id`
    // property, and `enum` members are values rather than subschemas.
    expect(buildSchemaRegistry({ enum: [{ $id: 'https://example.com/not-a-resource' }] })).toBeNull()
  })

  it('keeps the first declaration when two subschemas claim the same URI', () => {
    const root = {
      $id: 'https://example.com/root',
      allOf: [
        { $id: 'dup', type: 'number' },
        { $id: 'dup', type: 'string' },
      ],
    }
    const registry = buildSchemaRegistry(root)

    expect(registry?.resources.get('https://example.com/dup')).toBe(root.allOf[0])
  })

  it('survives a cyclic in-memory schema graph', () => {
    // Schemas parsed from JSON are trees, but `validate` is a plain function over
    // an arbitrary value, so the walk must terminate on a self-referential one.
    const root: Record<string, unknown> = { $id: 'https://example.com/root' }
    root['self'] = root

    expect(buildSchemaRegistry(root)?.rootBase).toBe('https://example.com/root')
  })
})
