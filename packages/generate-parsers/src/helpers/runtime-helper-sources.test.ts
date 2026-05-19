import { describe, expect, it } from 'vitest'
import { RUNTIME_HELPER_SOURCES } from '#generated/runtime-helper-sources'

describe('runtime-helper-sources snapshot', () => {
  it('contains the four expected runtime helpers', () => {
    expect(Object.keys(RUNTIME_HELPER_SOURCES).sort()).toEqual([
      'has-ref.ts',
      'is-object.ts',
      'validate-array.ts',
      'validate-record.ts',
    ])
  })

  it('embeds the isObject implementation', () => {
    expect(RUNTIME_HELPER_SOURCES['is-object.ts']).toContain('export const isObject')
  })

  it('embeds validate-array with the validateArray export', () => {
    expect(RUNTIME_HELPER_SOURCES['validate-array.ts']).toContain('export const validateArray')
  })

  it('embeds validate-record and preserves its relative import of is-object', () => {
    const source = RUNTIME_HELPER_SOURCES['validate-record.ts']
    expect(source).toContain('export const validateRecord')
    // The embedded copy must import is-object from a sibling _helpers entry, not from @amritk/helpers.
    expect(source).toContain("from './is-object'")
    expect(source).not.toContain('@amritk/helpers')
  })

  it('embeds has-ref without any external package imports', () => {
    const source = RUNTIME_HELPER_SOURCES['has-ref.ts']
    expect(source).toContain('export const hasRef')
    expect(source).not.toContain('json-schema-typed')
    expect(source).not.toContain('@amritk/helpers')
  })
})
