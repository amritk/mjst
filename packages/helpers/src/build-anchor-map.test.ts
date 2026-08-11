import { describe, expect, it } from 'vitest'

import { buildAnchorMap } from './build-anchor-map'
import { resolveRef } from './resolve-ref'

describe('build-anchor-map', () => {
  it('maps an $anchor to the pointer of the subschema declaring it', () => {
    const schema = { $defs: { address: { $anchor: 'addr', type: 'object' as const } } }

    expect(buildAnchorMap(schema)).toEqual({ addr: '#/$defs/address' })
  })

  // 2020-12 says a `$dynamicAnchor` also acts as a plain `$anchor`, so a static
  // `$ref: "#node"` has to find it.
  it('maps a $dynamicAnchor as a plain anchor too', () => {
    const schema = { $defs: { node: { $dynamicAnchor: 'node', type: 'object' as const } } }

    expect(buildAnchorMap(schema)).toEqual({ node: '#/$defs/node' })
  })

  it('maps an anchor on the document root to the root pointer', () => {
    expect(buildAnchorMap({ $anchor: 'root', type: 'object' as const })).toEqual({ root: '#' })
  })

  it('finds anchors nested anywhere, not just on $defs entries', () => {
    const schema = {
      type: 'object' as const,
      properties: { a: { allOf: [{ $anchor: 'deep', type: 'string' as const }] } },
    }

    expect(buildAnchorMap(schema)).toEqual({ deep: '#/properties/a/allOf/0' })
  })

  it('keeps the first occurrence when a name is declared twice', () => {
    const schema = {
      $defs: {
        a: { $anchor: 'dup', type: 'string' as const },
        b: { $anchor: 'dup', type: 'number' as const },
      },
    }

    expect(buildAnchorMap(schema)).toEqual({ dup: '#/$defs/a' })
  })

  // An `$anchor` sitting inside an example value is instance data, not a schema
  // keyword, so it must not become a resolvable target.
  it('ignores anchors inside data keywords', () => {
    const schema = { $defs: { a: { type: 'object' as const, examples: [{ $anchor: 'fake' }] } } }

    expect(buildAnchorMap(schema)).toEqual({})
  })

  // Anchor names come from the document, so `toString` must miss and
  // `__proto__` must be an ordinary entry rather than a prototype assignment.
  it('does not confuse an anchor name with an inherited Object member', () => {
    const schema = { $defs: { a: { $anchor: '__proto__', type: 'object' as const } } }
    const map = buildAnchorMap(schema)

    expect(map['toString']).toBeUndefined()
    expect(map['__proto__']).toBe('#/$defs/a')
  })

  it('escapes JSON Pointer characters in a key on the way to the anchor', () => {
    const schema = { $defs: { 'a/b': { $anchor: 'slash', type: 'object' as const } } }

    expect(buildAnchorMap(schema)).toEqual({ slash: '#/$defs/a~1b' })
  })

  it('returns an empty map for a boolean schema', () => {
    expect(buildAnchorMap(true)).toEqual({})
  })

  it('escapes a percent in a key the same way resolveRef decodes it', () => {
    // The pointer is handed back as a `$ref` fragment and percent-decoded on
    // the way in, so a local escaper that skipped `%` produced a pointer that
    // decoded to a different key — leaving the anchor unresolvable.
    const root = { $defs: { 'a%2Fb': { $anchor: 'target', type: 'string' } } }
    expect(resolveRef('#target', root as never)).toEqual({ $anchor: 'target', type: 'string' })
  })

  it('registers an anchor under a definition named after a data keyword', () => {
    // `$defs` maps author-chosen names to schemas, so `default` there is a
    // name. Skipping it as a keyword skipped the whole subtree, and the anchor
    // it declares became unresolvable.
    const root = { $defs: { default: { $anchor: 'thing', type: 'string' }, ok: { $anchor: 'other' } } }
    expect(buildAnchorMap(root as never)).toMatchObject({ thing: '#/$defs/default', other: '#/$defs/ok' })
    expect(resolveRef('#thing', root as never)).toEqual({ $anchor: 'thing', type: 'string' })
  })

  it('still skips an $anchor sitting in instance data', () => {
    // The other half of the same distinction: at a schema node those keys are
    // keywords, and an `$anchor` inside an enum member is a value, not a
    // declaration.
    expect(buildAnchorMap({ enum: [{ $anchor: 'notreal' }] } as never)).toEqual({})
    expect(buildAnchorMap({ example: { $anchor: 'notreal' } } as never)).toEqual({})
  })
})
