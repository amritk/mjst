import { describe, expect, it } from 'bun:test'

import { collectHelpers } from './collect-helpers'

describe('collect-helpers', () => {
  it('returns validateArray import when parser contains validateArray', () => {
    const result = collectHelpers('const items = validateArray(input, parseItem)')
    expect(result).toEqual(["import { validateArray } from './validators/validate-array';"])
  })

  it('returns validateRecord import when parser contains validateRecord', () => {
    const result = collectHelpers('const record = validateRecord(input, parseValue)')
    expect(result).toEqual(["import { validateRecord } from './validators/validate-record';"])
  })

  it('returns isObject import when parser contains isObject', () => {
    const result = collectHelpers('if (isObject(input)) {')
    expect(result).toEqual(["import { isObject } from 'mjst-helpers/is-object';"])
  })

  it('returns all three imports when parser uses all helpers', () => {
    const parser = `
      const arr = validateArray(input.items, parseItem)
      const rec = validateRecord(input.map, parseValue)
      if (isObject(input)) { return input }
    `
    const result = collectHelpers(parser)
    expect(result).toHaveLength(3)
    expect(result).toContain("import { validateArray } from './validators/validate-array';")
    expect(result).toContain("import { validateRecord } from './validators/validate-record';")
    expect(result).toContain("import { isObject } from 'mjst-helpers/is-object';")
  })

  it('returns empty array when parser uses no helpers', () => {
    const result = collectHelpers('const x = input.name ?? ""')
    expect(result).toEqual([])
  })

  it('returns only matching imports for partial usage', () => {
    const result = collectHelpers('const arr = validateArray(input, parse); const x = 1;')
    expect(result).toHaveLength(1)
    expect(result[0]).toContain('validateArray')
  })

  it('handles empty parser string', () => {
    const result = collectHelpers('')
    expect(result).toEqual([])
  })

  it('matches helpers as substrings in longer identifiers', () => {
    // The function uses .includes() so this would match
    const result = collectHelpers('const validateArrayItems = true')
    expect(result).toHaveLength(1)
  })
})
