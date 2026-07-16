import { describe, expect, it } from 'vitest'

import { evalGenerated } from './differential.test-utils'
import { generateParserFunction } from './generate-parser-function'

/**
 * End-to-end behavior of the `caseInsensitive` option: the generated coercing
 * parsers are compiled and run against real inputs (via {@link evalGenerated}),
 * so these assert observable output rather than emitted text.
 */
describe('caseInsensitive coercion (end-to-end)', () => {
  const compile = (schema: Parameters<typeof generateParserFunction>[0], caseInsensitive: boolean) =>
    evalGenerated<(input: unknown) => unknown>(
      generateParserFunction(schema, 'T', { useRefImports: true, ...(caseInsensitive ? { caseInsensitive } : {}) }),
      'parseT',
    )

  describe('object property enum', () => {
    const schema = {
      type: 'object' as const,
      properties: { role: { type: 'string' as const, enum: ['admin', 'guest'] } },
      required: ['role'],
    }

    it('normalizes a mis-cased member to its exact casing', () => {
      const parse = compile(schema, true)
      expect(parse({ role: 'aDmIn' })).toEqual({ role: 'admin' })
      expect(parse({ role: 'GUEST' })).toEqual({ role: 'guest' })
    })

    it('leaves an already-correct member untouched', () => {
      const parse = compile(schema, true)
      expect(parse({ role: 'admin' })).toEqual({ role: 'admin' })
    })

    it('coerces a genuine non-member to the default (first member)', () => {
      const parse = compile(schema, true)
      expect(parse({ role: 'root' })).toEqual({ role: 'admin' })
      expect(parse({ role: 42 })).toEqual({ role: 'admin' })
    })

    it('off: a mis-cased member coerces to the default, not normalized', () => {
      const parse = compile(schema, false)
      expect(parse({ role: 'GUEST' })).toEqual({ role: 'admin' })
    })

    it('does not leak Object.prototype members through the case-fold lookup', () => {
      // A non-member input that collides with an inherited name (`constructor`,
      // `toString`) must coerce to the default, not to the `Object.prototype`
      // function a plain-object lookup would return.
      const parse = compile(schema, true)
      expect(parse({ role: 'constructor' })).toEqual({ role: 'admin' })
      expect(parse({ role: 'toString' })).toEqual({ role: 'admin' })
    })

    it('normalizes a member whose folded key collides with an inherited name', () => {
      // `constructor` is a legitimate enum member here; a mis-cased input must
      // still normalize to it (a plain-object map would have dropped it).
      const withProto = {
        type: 'object' as const,
        properties: { kind: { type: 'string' as const, enum: ['constructor', 'toString'] } },
        required: ['kind'],
      }
      const parse = compile(withProto, true)
      expect(parse({ kind: 'CONSTRUCTOR' })).toEqual({ kind: 'constructor' })
      expect(parse({ kind: 'TOSTRING' })).toEqual({ kind: 'toString' })
    })
  })

  describe('optional property enum', () => {
    const schema = {
      type: 'object' as const,
      properties: { role: { type: 'string' as const, enum: ['admin', 'guest'] } },
    }

    it('normalizes a present mis-cased value', () => {
      const parse = compile(schema, true)
      expect(parse({ role: 'GuEsT' })).toEqual({ role: 'guest' })
    })

    it('omits an absent optional property', () => {
      const parse = compile(schema, true)
      expect(parse({})).toEqual({})
    })
  })

  describe('array items enum', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        colors: { type: 'array' as const, items: { type: 'string' as const, enum: ['red', 'green', 'blue'] } },
      },
      required: ['colors'],
    }

    it('normalizes each mis-cased element', () => {
      const parse = compile(schema, true)
      expect(parse({ colors: ['ReD', 'GREEN', 'blue', 'orange'] })).toEqual({
        colors: ['red', 'green', 'blue', 'red'],
      })
    })
  })

  describe('top-level enum', () => {
    const schema = { type: 'string' as const, enum: ['GET', 'POST'] }

    it('normalizes a mis-cased value', () => {
      const parse = compile(schema, true)
      expect(parse('post')).toBe('POST')
      expect(parse('GeT')).toBe('GET')
    })

    it('off: coerces a mis-cased value to the first member', () => {
      const parse = compile(schema, false)
      expect(parse('post')).toBe('GET')
    })
  })

  describe('mixed-type enum', () => {
    // Only the string member folds by case; numbers/booleans have no casing.
    const schema = {
      type: 'object' as const,
      properties: { v: { enum: ['Yes', 1, true] } },
      required: ['v'],
    }

    it('normalizes the string member and leaves exact non-string members', () => {
      const parse = compile(schema, true)
      expect(parse({ v: 'yes' })).toEqual({ v: 'Yes' })
      expect(parse({ v: 1 })).toEqual({ v: 1 })
      expect(parse({ v: true })).toEqual({ v: true })
    })
  })
})
