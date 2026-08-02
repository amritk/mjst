import { describe, expect, it } from 'vitest'

import { buildResourceRegistry, SYNTHETIC_BASE } from './build-resource-registry'

describe('build-resource-registry', () => {
  // The `null` is the whole fast path: a document with no `$id` has one base URI,
  // so every consumer can skip base-URI resolution entirely.
  it('returns null for a document that declares no $id', () => {
    expect(buildResourceRegistry({ $defs: { a: { type: 'string' } } })).toBeNull()
  })

  it('returns null for anything that is not an object', () => {
    expect(buildResourceRegistry(true)).toBeNull()
    expect(buildResourceRegistry(null)).toBeNull()
  })

  it('registers the root under its own $id and under the synthetic base', () => {
    const registry = buildResourceRegistry({ $id: 'http://example.com/a.json', type: 'object' })

    expect(registry?.rootBase).toBe('http://example.com/a.json')
    expect(registry?.resources.get('http://example.com/a.json')).toBe('')
    expect(registry?.resources.get(SYNTHETIC_BASE)).toBe('')
  })

  // The point of the whole file: a nested `$id` is resolved against the base its
  // *parent* established, not against the document root.
  it('composes a nested $id against the base in scope', () => {
    const registry = buildResourceRegistry({
      $id: 'http://example.com/a.json',
      $defs: {
        x: { $id: 'http://example.com/b/c.json', not: { $defs: { y: { $id: 'd.json', type: 'number' } } } },
      },
    })

    expect(registry?.resources.get('http://example.com/b/c.json')).toBe('/$defs/x')
    expect(registry?.resources.get('http://example.com/b/d.json')).toBe('/$defs/x/not/$defs/y')
  })

  it('scopes each $anchor to the resource that declares it', () => {
    const registry = buildResourceRegistry({
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
    })

    expect(registry?.anchors.get('http://localhost:1234/child1#my_anchor')).toBe('/$defs/A/allOf/1')
    expect(registry?.anchors.get('http://localhost:1234/child2#my_anchor')).toBe('/$defs/A/allOf/0')
  })

  // 2020-12 says a `$dynamicAnchor` also creates a plain anchor of the same name.
  it('registers a $dynamicAnchor in both maps', () => {
    const registry = buildResourceRegistry({ $id: 'http://example.com/a', $defs: { t: { $dynamicAnchor: 'node' } } })

    expect(registry?.dynamicAnchors.get('http://example.com/a#node')).toBe('/$defs/t')
    expect(registry?.anchors.get('http://example.com/a#node')).toBe('/$defs/t')
  })

  it('keeps the first declaration when a URI or anchor name repeats', () => {
    const registry = buildResourceRegistry({
      $id: 'http://example.com/a',
      $defs: { first: { $id: 'dup', type: 'string' }, second: { $id: 'dup', type: 'number' } },
    })

    expect(registry?.resources.get('http://example.com/dup')).toBe('/$defs/first')
  })

  // A draft-07-style `$id: "#name"` is an anchor, not a base URI.
  it('ignores an $id that is only a fragment', () => {
    expect(buildResourceRegistry({ $defs: { a: { $id: '#named', type: 'string' } } })).toBeNull()
  })

  it('ignores declarations that are instance data rather than schema', () => {
    expect(buildResourceRegistry({ type: 'object', examples: [{ $id: 'http://example.com/x' }] })).toBeNull()
  })

  it('handles a URN base, which has no path to resolve against', () => {
    const registry = buildResourceRegistry({
      $id: 'urn:uuid:deadbeef-1234-0000-0000-4321feebdaed',
      $defs: { bar: { $anchor: 'something', type: 'string' } },
    })

    expect(registry?.rootBase).toBe('urn:uuid:deadbeef-1234-0000-0000-4321feebdaed')
    expect(registry?.anchors.get('urn:uuid:deadbeef-1234-0000-0000-4321feebdaed#something')).toBe('/$defs/bar')
  })

  // A key containing `/` or `~` has to survive the round trip through a pointer,
  // and `%` has to survive the percent-decoding a `$ref` fragment goes through.
  it('escapes pointer segments so an awkward definition name still resolves', () => {
    const registry = buildResourceRegistry({
      $id: 'http://example.com/a',
      $defs: { 'a/b': { $id: 'inner', type: 'string' }, 'c%2Fd': { $id: 'other', $anchor: 'x' } },
    })

    expect(registry?.resources.get('http://example.com/inner')).toBe('/$defs/a~1b')
    expect(registry?.anchors.get('http://example.com/other#x')).toBe('/$defs/c%252Fd')
  })
})
