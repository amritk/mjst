import { describe, expect, it } from 'vitest'

import { collectHelpers } from './collect-helpers'

describe('collect-helpers', () => {
  describe('package mode', () => {
    it('returns validateArray import when parser contains validateArray', () => {
      const result = collectHelpers('const items = validateArray(input, parseItem)', 'package')
      expect(result.imports).toEqual(["import { validateArray } from '@amritk/helpers/validate-array';"])
      expect(result.used).toEqual(new Set(['validate-array']))
    })

    it('returns validateRecord import (and transitively flags is-object) for embedded shipping', () => {
      const result = collectHelpers('const record = validateRecord(input, parseValue)', 'package')
      expect(result.imports).toEqual(["import { validateRecord } from '@amritk/helpers/validate-record';"])
      expect(result.used).toEqual(new Set(['validate-record', 'is-object']))
    })

    it('returns isObject import when parser contains isObject', () => {
      const result = collectHelpers('if (isObject(input)) {', 'package')
      expect(result.imports).toEqual(["import { isObject } from '@amritk/helpers/is-object';"])
      expect(result.used).toEqual(new Set(['is-object']))
    })

    it('returns hasRef import from schema-guards when parser contains hasRef(', () => {
      const result = collectHelpers('if (hasRef(s)) { return parseFoo(input) }', 'package')
      expect(result.imports).toEqual(["import { hasRef } from '@amritk/helpers/schema-guards';"])
      expect(result.used).toEqual(new Set(['has-ref']))
    })

    it('returns all imports when parser uses every helper', () => {
      const parser = `
        const arr = validateArray(input.items, parseItem)
        const rec = validateRecord(input.map, parseValue)
        if (isObject(input)) { return input }
        if (hasRef(schema)) { /* */ }
      `
      const result = collectHelpers(parser, 'package')
      expect(result.imports).toHaveLength(4)
      expect(result.imports).toContain("import { validateArray } from '@amritk/helpers/validate-array';")
      expect(result.imports).toContain("import { validateRecord } from '@amritk/helpers/validate-record';")
      expect(result.imports).toContain("import { isObject } from '@amritk/helpers/is-object';")
      expect(result.imports).toContain("import { hasRef } from '@amritk/helpers/schema-guards';")
      expect(result.used).toEqual(new Set(['validate-array', 'validate-record', 'is-object', 'has-ref']))
    })

    it('returns empty result when parser uses no helpers', () => {
      const result = collectHelpers('const x = input.name ?? ""', 'package')
      expect(result.imports).toEqual([])
      expect(result.used.size).toBe(0)
    })

    it('handles empty parser string', () => {
      const result = collectHelpers('', 'package')
      expect(result.imports).toEqual([])
      expect(result.used.size).toBe(0)
    })

    it('matches helpers as substrings in longer identifiers (existing .includes() behaviour)', () => {
      const result = collectHelpers('const validateArrayItems = true', 'package')
      expect(result.imports).toHaveLength(1)
      expect(result.used.has('validate-array')).toBe(true)
    })
  })

  describe('embedded mode', () => {
    it('emits relative imports targeting ./_helpers/', () => {
      const parser = `
        const arr = validateArray(input.items, parseItem)
        const rec = validateRecord(input.map, parseValue)
        if (isObject(input)) { return input }
        if (hasRef(schema)) { /* */ }
      `
      const result = collectHelpers(parser, 'embedded')
      expect(result.imports).toContain("import { validateArray } from './_helpers/validate-array';")
      expect(result.imports).toContain("import { validateRecord } from './_helpers/validate-record';")
      expect(result.imports).toContain("import { isObject } from './_helpers/is-object';")
      expect(result.imports).toContain("import { hasRef } from './_helpers/has-ref';")
    })

    it('marks is-object as used when validateRecord is referenced (transitive dep)', () => {
      // validate-record.ts imports isObject, so the embedded build must ship is-object too,
      // even if the generated parser body itself never mentions isObject directly.
      const result = collectHelpers('const record = validateRecord(input, parseValue)', 'embedded')
      expect(result.used.has('validate-record')).toBe(true)
      expect(result.used.has('is-object')).toBe(true)
    })

    it('does not duplicate the isObject import line when only validateRecord is referenced', () => {
      const result = collectHelpers('const record = validateRecord(input, parseValue)', 'embedded')
      expect(result.imports).toEqual(["import { validateRecord } from './_helpers/validate-record';"])
    })

    it('emits both validateRecord and isObject import lines when both names appear', () => {
      const result = collectHelpers(
        'if (!isObject(input)) return {}; const r = validateRecord(input, parse)',
        'embedded',
      )
      expect(result.imports).toContain("import { validateRecord } from './_helpers/validate-record';")
      expect(result.imports).toContain("import { isObject } from './_helpers/is-object';")
    })
  })
})
