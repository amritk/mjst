import { describe, expect, it } from 'vitest'

import { resolveDynamicRefs } from './resolve-dynamic-refs'

describe('resolve-dynamic-refs', () => {
  it('replaces $dynamicRef with $ref in properties', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        schema: { $dynamicRef: '#meta' },
      },
    }

    const result = resolveDynamicRefs(schema, { '#meta': '#/$defs/schema' })

    expect(result).toEqual({
      type: 'object',
      properties: {
        schema: { $ref: '#/$defs/schema' },
      },
    })
  })

  it('replaces $dynamicRef in additionalProperties', () => {
    const schema = {
      type: 'object' as const,
      additionalProperties: { $dynamicRef: '#meta' },
    }

    const result = resolveDynamicRefs(schema, { '#meta': '#/$defs/schema' })

    expect(result).toEqual({
      type: 'object',
      additionalProperties: { $ref: '#/$defs/schema' },
    })
  })

  it('does not mutate the original schema', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        schema: { $dynamicRef: '#meta' },
      },
    }

    resolveDynamicRefs(schema, { '#meta': '#/$defs/schema' })

    // Original should be unchanged
    expect(schema.properties.schema).toEqual({ $dynamicRef: '#meta' })
  })

  it('returns schema unchanged when it carries no $dynamicRef', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        schema: { type: 'string' as const },
      },
    }

    expect(resolveDynamicRefs(schema, {})).toBe(schema)
  })

  // Leaving an unmapped `$dynamicRef` in place was the silent failure: the type
  // generator then named the type after the anchor, so `#node` compiled against
  // the DOM's `Node` and shipped the wrong type instead of failing the build.
  it('throws when a $dynamicRef has no $dynamicAnchor to bind to', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        schema: { $dynamicRef: '#meta' },
      },
    }

    expect(() => resolveDynamicRefs(schema, {})).toThrow(/Unresolvable \$dynamicRef "#meta"/)
  })

  // A pointer form names no anchor, so 2020-12 says it behaves like a plain
  // `$ref` — which keeps a bundled document that spells it that way working.
  it('degrades a JSON Pointer $dynamicRef to a plain $ref', () => {
    const schema = { properties: { a: { $dynamicRef: '#/$defs/thing' } } }

    expect(resolveDynamicRefs(schema, {})).toEqual({ properties: { a: { $ref: '#/$defs/thing' } } })
  })

  it('returns non-object schemas unchanged', () => {
    expect(resolveDynamicRefs(true, { '#meta': '#/$defs/schema' })).toBe(true)
    expect(resolveDynamicRefs(false, { '#meta': '#/$defs/schema' })).toBe(false)
  })

  it('replaces $dynamicRef nested inside an array keyword (allOf)', () => {
    const schema = {
      allOf: [{ $dynamicRef: '#meta' }, { type: 'object' as const, properties: { x: { $dynamicRef: '#meta' } } }],
    }

    const result = resolveDynamicRefs(schema, { '#meta': '#/$defs/schema' })

    expect(result).toEqual({
      allOf: [{ $ref: '#/$defs/schema' }, { type: 'object', properties: { x: { $ref: '#/$defs/schema' } } }],
    })
  })

  it('handles nested $dynamicRef in property sub-schemas', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        schemas: {
          type: 'object' as const,
          additionalProperties: { $dynamicRef: '#meta' },
        },
      },
    }

    const result = resolveDynamicRefs(schema, { '#meta': '#/$defs/schema' })

    const expected = {
      type: 'object',
      properties: {
        schemas: {
          type: 'object',
          additionalProperties: { $ref: '#/$defs/schema' },
        },
      },
    }
    expect(result).toEqual(expected)
  })

  // The cheap pre-scan that decides whether to clone at all has to agree with
  // the rewrite about which keys hold instance data. Testing key names alone
  // skipped the subtree of a property genuinely *named* `enum`, so the document
  // read as "no dynamic refs" and the ref survived into generation.
  it('rewrites a $dynamicRef under a property named like a data keyword', () => {
    const schema = {
      $defs: { node: { $dynamicAnchor: 'node', type: 'string' as const } },
      type: 'object' as const,
      properties: {
        enum: { $dynamicRef: '#node' },
        default: { $dynamicRef: '#node' },
      },
    }

    const result = resolveDynamicRefs(schema, { '#node': '#/$defs/node' }) as Record<string, never>

    expect(result['properties']).toEqual({
      enum: { $ref: '#/$defs/node' },
      default: { $ref: '#/$defs/node' },
    })
  })

  it('still leaves a $dynamicRef inside an actual enum value alone', () => {
    const schema = { type: 'object' as const, enum: [{ $dynamicRef: '#node' }] }

    expect(resolveDynamicRefs(schema, { '#node': '#/$defs/node' })).toBe(schema)
  })
})
