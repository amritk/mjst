import { describe, expect, it } from 'bun:test'
import { buildDynamicRefMap } from '#parser/helpers/build-dynamic-ref-map'

describe('build-dynamic-ref-map', () => {
  it('maps $dynamicAnchor values to $ref paths', () => {
    const schema = {
      type: 'object' as const,
      $defs: {
        schema: {
          $dynamicAnchor: 'meta',
          type: 'object',
        },
      },
    }

    const result = buildDynamicRefMap(schema)
    expect(result).toEqual({ '#meta': '#/$defs/schema' })
  })

  it('returns empty map when no $dynamicAnchor exists', () => {
    const schema = {
      type: 'object' as const,
      $defs: {
        info: { type: 'object' },
      },
    }

    const result = buildDynamicRefMap(schema)
    expect(result).toEqual({})
  })

  it('returns empty map for non-object schema', () => {
    const result = buildDynamicRefMap(true)
    expect(result).toEqual({})
  })

  it('returns empty map when no $defs exist', () => {
    const schema = { type: 'object' as const }
    const result = buildDynamicRefMap(schema)
    expect(result).toEqual({})
  })

  it('handles multiple $dynamicAnchor definitions', () => {
    const schema = {
      type: 'object' as const,
      $defs: {
        schema: {
          $dynamicAnchor: 'meta',
          type: 'object',
        },
        other: {
          $dynamicAnchor: 'other-anchor',
          type: 'string',
        },
      },
    }

    const result = buildDynamicRefMap(schema)
    expect(result).toEqual({
      '#meta': '#/$defs/schema',
      '#other-anchor': '#/$defs/other',
    })
  })
})
