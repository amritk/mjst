import { describe, expect, it } from 'vitest'

import { buildDynamicRefMap } from './build-dynamic-ref-map'

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

  it('maps a $dynamicAnchor nested below a $defs entry', () => {
    const schema = {
      type: 'object' as const,
      $defs: {
        outer: {
          type: 'object',
          properties: {
            inner: { $dynamicAnchor: 'node', type: 'object' },
          },
        },
      },
    }

    expect(buildDynamicRefMap(schema)).toEqual({ '#node': '#/$defs/outer/properties/inner' })
  })

  it('maps a $dynamicAnchor outside $defs entirely', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        payload: { $dynamicAnchor: 'meta', type: 'object' },
      },
    }

    expect(buildDynamicRefMap(schema)).toEqual({ '#meta': '#/properties/payload' })
  })

  it('maps a $dynamicAnchor inside a combinator array branch', () => {
    const schema = {
      oneOf: [{ type: 'string' }, { $dynamicAnchor: 'branch', type: 'object' }],
    } as const

    expect(buildDynamicRefMap(schema)).toEqual({ '#branch': '#/oneOf/1' })
  })

  it('escapes JSON Pointer special characters in keys on the path', () => {
    const schema = {
      $defs: {
        'a/b': { properties: { 'c~d': { $dynamicAnchor: 'odd' } } },
      },
    } as const

    expect(buildDynamicRefMap(schema)).toEqual({ '#odd': '#/$defs/a~1b/properties/c~0d' })
  })

  it('keeps the first occurrence when an anchor name is declared twice', () => {
    const schema = {
      $defs: {
        first: { $dynamicAnchor: 'meta' },
        second: { $dynamicAnchor: 'meta' },
      },
    } as const

    expect(buildDynamicRefMap(schema)).toEqual({ '#meta': '#/$defs/first' })
  })

  it('ignores a $dynamicAnchor key inside enum/const/example data', () => {
    const schema = {
      $defs: {
        data: { enum: [{ $dynamicAnchor: 'fake' }], const: { $dynamicAnchor: 'fake2' } },
      },
    } as const

    expect(buildDynamicRefMap(schema)).toEqual({})
  })

  it('skips a $dynamicAnchor on the document root itself', () => {
    const schema = { $dynamicAnchor: 'meta', type: 'object' as const }

    expect(buildDynamicRefMap(schema)).toEqual({})
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
