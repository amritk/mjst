import { describe, expect, it } from 'vitest'

import { resolveDynamicRef } from './resolve-dynamic-ref'

describe('resolve-dynamic-ref', () => {
  const root = {
    type: 'object',
    properties: {
      schema: { $dynamicRef: '#meta' },
    },
    $defs: {
      schema: { $dynamicAnchor: 'meta', type: 'object' },
      user: { type: 'string' },
    },
  }

  it('binds a plain-name fragment to its $dynamicAnchor', () => {
    expect(resolveDynamicRef('#meta', root)).toBe(root.$defs.schema)
  })

  it('returns undefined for a non-local ref', () => {
    expect(resolveDynamicRef('https://example.com/schema.json', root)).toBeUndefined()
  })

  it('returns undefined when no matching $dynamicAnchor exists', () => {
    // No `$dynamicAnchor: "missing"` anywhere, and "#missing" is not a pointer,
    // so the static fallback (an `$anchor` search) finds nothing either.
    expect(resolveDynamicRef('#missing', root)).toBeUndefined()
  })

  it('falls back to static pointer resolution for a JSON Pointer fragment', () => {
    expect(resolveDynamicRef('#/$defs/user', root)).toBe(root.$defs.user)
  })

  it('binds to the first matching anchor when several share a name', () => {
    // We resolve to the document-global anchor rather than walking the dynamic
    // scope, so the first one found in document order wins.
    const multi = {
      $defs: {
        a: { $dynamicAnchor: 'node', type: 'string' },
        b: { $dynamicAnchor: 'node', type: 'number' },
      },
    }
    expect(resolveDynamicRef('#node', multi)).toBe(multi.$defs.a)
  })
})
