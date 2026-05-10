import { describe, expect, it } from 'vitest'

import { resolveRef } from './resolve-ref'

describe('resolveRef', () => {
  it('resolves a simple $ref to $defs', () => {
    const schema = {
      $defs: {
        contact: {
          type: 'object',
          properties: {
            email: { type: 'string' },
            phone: { type: 'string' },
          },
        },
      },
    }

    const result = resolveRef('#/$defs/contact', schema)

    expect(result).toEqual({
      type: 'object',
      properties: {
        email: { type: 'string' },
        phone: { type: 'string' },
      },
    })
  })

  it('resolves a nested $ref', () => {
    const schema = {
      components: {
        schemas: {
          User: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              age: { type: 'number' },
            },
          },
        },
      },
    }

    const result = resolveRef('#/components/schemas/User', schema)

    expect(result).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
    })
  })

  it('returns undefined for non-existent $ref', () => {
    const schema = {
      $defs: {
        contact: { type: 'object' },
      },
    }

    const result = resolveRef('#/$defs/nonexistent', schema)

    expect(result).toBeUndefined()
  })

  it('returns undefined for URI refs not present in $defs', () => {
    const schema = {
      $defs: {
        contact: { type: 'object' },
      },
    }

    const result = resolveRef('http://example.com/schema.json', schema)

    expect(result).toBeUndefined()
  })

  it('resolves a URI ref that is a $defs key', () => {
    const schema = {
      $defs: {
        'http://example.com/channel.json': { type: 'object', properties: { name: { type: 'string' } } },
      },
    }

    const result = resolveRef('http://example.com/channel.json', schema)

    expect(result).toEqual({ type: 'object', properties: { name: { type: 'string' } } })
  })

  it('resolves a URI ref with a fragment into a nested definition', () => {
    const schema = {
      $defs: {
        'http://example.com/channel.json': {
          type: 'object',
          $defs: {
            queue: { type: 'object', properties: { name: { type: 'string' } } },
          },
        },
      },
    }

    const result = resolveRef('http://example.com/channel.json#/$defs/queue', schema)

    expect(result).toEqual({ type: 'object', properties: { name: { type: 'string' } } })
  })

  it('handles URI-encoded characters in $ref', () => {
    const schema = {
      $defs: {
        'my~field': {
          type: 'string',
        },
      },
    }

    // ~0 represents ~
    const result = resolveRef('#/$defs/my~0field', schema)

    expect(result).toEqual({ type: 'string' })
  })

  it('resolves deeply nested $ref', () => {
    const schema = {
      definitions: {
        nested: {
          deep: {
            value: {
              type: 'boolean',
            },
          },
        },
      },
    }

    const result = resolveRef('#/definitions/nested/deep/value', schema)

    expect(result).toEqual({ type: 'boolean' })
  })

  it('returns undefined for empty $ref', () => {
    const schema = {
      $defs: {
        contact: { type: 'object' },
      },
    }

    const result = resolveRef('#', schema)

    expect(result).toEqual(schema)
  })

  it('handles $ref to array items', () => {
    const schema = {
      $defs: {
        stringArray: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    }

    const result = resolveRef('#/$defs/stringArray', schema)

    expect(result).toEqual({
      type: 'array',
      items: { type: 'string' },
    })
  })

  it('returns undefined when a path segment resolves to a non-object value', () => {
    // When a path segment exists but its value is a primitive (not an object),
    // navigation cannot continue and the ref is unresolvable.
    const schema = {
      $defs: {
        // "count" is a number, not an object — resolveRef cannot navigate into it
        count: 42,
      },
    }

    const result = resolveRef('#/$defs/count', schema as unknown as Record<string, unknown>)

    expect(result).toBeUndefined()
  })
})
