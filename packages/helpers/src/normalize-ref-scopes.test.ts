import { describe, expect, it } from 'vitest'

import { normalizeRefScopes } from './normalize-ref-scopes'

describe('normalize-ref-scopes', () => {
  // Identity, not a copy: a document with one base URI already means what it
  // says, and every downstream cache is keyed on the object.
  it('returns a document with no $id unchanged, by identity', () => {
    const schema = { properties: { a: { $ref: '#/$defs/t' } }, $defs: { t: { type: 'string' } } }

    expect(normalizeRefScopes(schema)).toBe(schema)
  })

  it('leaves an already-correct pointer alone rather than rebuilding the tree', () => {
    const defs = { t: { type: 'string' } }
    const schema = { $id: 'http://example.com/a.json', properties: { a: { $ref: '#/$defs/t' } }, $defs: defs }

    expect(normalizeRefScopes(schema)['$defs']).toBe(defs)
  })

  it('rewrites a relative ref to the resource it names', () => {
    const schema = {
      $id: 'http://localhost:1234/tree',
      properties: { nodes: { items: { $ref: 'node' } } },
      $defs: { node: { $id: 'http://localhost:1234/node', properties: { subtree: { $ref: 'tree' } } } },
    }

    const normalized = normalizeRefScopes(schema) as Record<string, Record<string, Record<string, unknown>>>

    expect(normalized['properties']?.['nodes']?.['items']).toEqual({ $ref: '#/$defs/node' })
    expect(normalized['$defs']?.['node']?.['properties']).toEqual({ subtree: { $ref: '#' } })
  })

  // The dangerous half: this used to quietly resolve to the *outer* `t`.
  it('resolves a bare fragment against its own embedded resource', () => {
    const schema = {
      $defs: {
        t: { type: 'string' },
        inner: {
          $id: 'https://example.com/inner',
          $defs: { t: { type: 'number' } },
          properties: { value: { $ref: '#/$defs/t' } },
        },
      },
    }

    const normalized = normalizeRefScopes(schema) as Record<string, Record<string, Record<string, unknown>>>

    expect(normalized['$defs']?.['inner']?.['properties']).toEqual({ value: { $ref: '#/$defs/inner/$defs/t' } })
  })

  it('resolves an $id composed against the nearest parent, not the document root', () => {
    const schema = {
      $id: 'http://example.com/a.json',
      $defs: { x: { $id: 'http://example.com/b/c.json', not: { $defs: { y: { $id: 'd.json', type: 'number' } } } } },
      allOf: [{ $ref: 'http://example.com/b/d.json' }],
    }

    expect((normalizeRefScopes(schema)['allOf'] as unknown[])[0]).toEqual({ $ref: '#/$defs/x/not/$defs/y' })
  })

  it('resolves an anchor inside a named resource', () => {
    const schema = {
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
      $ref: 'child1#my_anchor',
    }

    expect(normalizeRefScopes(schema)['$ref']).toBe('#/$defs/A/allOf/1')
  })

  it('resolves a URN base and a pointer written through it', () => {
    const schema = {
      $id: 'urn:uuid:deadbeef-1234-0000-0000-4321feebdaed',
      properties: { foo: { $ref: 'urn:uuid:deadbeef-1234-0000-0000-4321feebdaed#/$defs/bar' } },
      $defs: { bar: { type: 'string' } },
    }

    const normalized = normalizeRefScopes(schema) as Record<string, Record<string, unknown>>

    expect(normalized['properties']?.['foo']).toEqual({ $ref: '#/$defs/bar' })
  })

  // Another document is not this package's business, and inventing a target
  // would be worse than leaving the ref where the caller can still see it.
  it('leaves a ref it cannot place exactly as written', () => {
    const schema = {
      $id: 'http://example.com/a.json',
      allOf: [{ $ref: 'http://elsewhere.example/other.json' }, { $ref: '#/$defs/nope' }],
    }

    expect(normalizeRefScopes(schema)['allOf']).toEqual([
      { $ref: 'http://elsewhere.example/other.json' },
      { $ref: '#/$defs/nope' },
    ])
  })

  // Bookended: static resolution lands on a `$dynamicAnchor` of the same name, so
  // the reference keeps its late binding and stays written as the anchor name.
  it('keeps a bookended $dynamicRef bound by anchor name', () => {
    const schema = {
      $id: 'https://test.example/root',
      $ref: 'list',
      $defs: {
        list: {
          $id: 'list',
          items: { $dynamicRef: '#items' },
          $defs: { items: { $dynamicAnchor: 'items' } },
        },
      },
    }

    const normalized = normalizeRefScopes(schema) as Record<string, Record<string, Record<string, unknown>>>

    expect(normalized['$defs']?.['list']?.['items']).toEqual({ $dynamicRef: '#items' })
  })

  // No bookend — the name only matches a plain `$anchor` — so 2020-12 says it
  // behaves statically, and it is rewritten exactly like a `$ref`.
  it('degrades an unbookended $dynamicRef to a static pointer', () => {
    const schema = {
      $id: 'https://test.example/root',
      items: { $dynamicRef: '#items' },
      $defs: { foo: { $anchor: 'items', type: 'string' } },
    }

    expect(normalizeRefScopes(schema)['items']).toEqual({ $dynamicRef: '#/$defs/foo' })
  })

  it('ignores a $ref that is instance data rather than a reference', () => {
    const schema = {
      $id: 'http://example.com/a.json',
      $defs: { t: { $id: 'inner', type: 'string' } },
      properties: { a: { const: { $ref: 'inner' } } },
    }

    const normalized = normalizeRefScopes(schema) as Record<string, Record<string, Record<string, unknown>>>

    expect(normalized['properties']?.['a']?.['const']).toEqual({ $ref: 'inner' })
  })
})
