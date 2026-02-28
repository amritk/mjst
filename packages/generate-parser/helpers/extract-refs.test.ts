import { describe, expect, it } from 'vitest'
import { extractRefs } from './extract-refs'

describe('extract-refs', () => {
  it('extracts refs from a simple schema', () => {
    const schema = {
      type: 'object',
      properties: {
        contact: { $ref: '#/$defs/contact' },
        server: { $ref: '#/$defs/server' },
      },
    }

    const refs = extractRefs(schema)

    expect(refs).toEqual(new Set(['#/$defs/contact', '#/$defs/server']))
  })

  it('extracts refs from nested objects', () => {
    const schema = {
      type: 'object',
      properties: {
        info: {
          type: 'object',
          properties: {
            contact: { $ref: '#/$defs/contact' },
          },
        },
      },
    }

    const refs = extractRefs(schema)

    expect(refs).toEqual(new Set(['#/$defs/contact']))
  })

  it('extracts refs from arrays', () => {
    const schema = {
      type: 'object',
      properties: {
        servers: {
          type: 'array',
          items: { $ref: '#/$defs/server' },
        },
      },
    }

    const refs = extractRefs(schema)

    expect(refs).toEqual(new Set(['#/$defs/server']))
  })

  it('extracts refs from allOf, anyOf, oneOf', () => {
    const schema = {
      allOf: [{ $ref: '#/$defs/base' }],
      anyOf: [{ $ref: '#/$defs/option1' }, { $ref: '#/$defs/option2' }],
      oneOf: [{ $ref: '#/$defs/choice1' }],
    }

    const refs = extractRefs(schema)

    expect(refs).toEqual(
      new Set(['#/$defs/base', '#/$defs/option1', '#/$defs/option2', '#/$defs/choice1']),
    )
  })

  it('extracts refs from additionalProperties', () => {
    const schema = {
      type: 'object',
      additionalProperties: { $ref: '#/$defs/value' },
    }

    const refs = extractRefs(schema)

    expect(refs).toEqual(new Set(['#/$defs/value']))
  })

  it('ignores external refs', () => {
    const schema = {
      type: 'object',
      properties: {
        internal: { $ref: '#/$defs/internal' },
        external: { $ref: 'https://example.com/schema.json' },
      },
    }

    const refs = extractRefs(schema)

    expect(refs).toEqual(new Set(['#/$defs/internal']))
  })

  it('returns empty set when no refs exist', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
    }

    const refs = extractRefs(schema)

    expect(refs).toEqual(new Set())
  })

  it('handles deeply nested refs', () => {
    const schema = {
      type: 'object',
      properties: {
        level1: {
          type: 'object',
          properties: {
            level2: {
              type: 'object',
              properties: {
                level3: { $ref: '#/$defs/deep' },
              },
            },
          },
        },
      },
    }

    const refs = extractRefs(schema)

    expect(refs).toEqual(new Set(['#/$defs/deep']))
  })

  it('deduplicates refs', () => {
    const schema = {
      type: 'object',
      properties: {
        contact1: { $ref: '#/$defs/contact' },
        contact2: { $ref: '#/$defs/contact' },
        contact3: { $ref: '#/$defs/contact' },
      },
    }

    const refs = extractRefs(schema)

    expect(refs).toEqual(new Set(['#/$defs/contact']))
  })
})
