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

  // `$anchor` is a core 2020-12 keyword, but every `#`-prefixed ref was treated
  // as a JSON Pointer, so `#named` matched nothing — and the caller went on to
  // derive the filename `#named`, producing an import specifier ESM reads as a
  // URL fragment.
  it('resolves a plain $anchor ref', () => {
    const schema = {
      $defs: {
        address: { $anchor: 'addr', type: 'object', properties: { city: { type: 'string' } } },
      },
    }

    expect(resolveRef('#addr', schema)).toEqual({
      $anchor: 'addr',
      type: 'object',
      properties: { city: { type: 'string' } },
    })
  })

  // 2020-12 says a `$dynamicAnchor` also behaves as a plain `$anchor`, so a
  // static `$ref` is allowed to target one.
  it('resolves a $ref pointed at a $dynamicAnchor', () => {
    const schema = { $defs: { node: { $dynamicAnchor: 'node', type: 'object' } } }

    expect(resolveRef('#node', schema)).toEqual({ $dynamicAnchor: 'node', type: 'object' })
  })

  it('returns undefined for an anchor nothing declares', () => {
    expect(resolveRef('#nope', { $defs: { a: { type: 'object' } } })).toBeUndefined()
  })

  // A `$ref` fragment travels as a URI, so a definition named `percent%field` is
  // written `percent%25field`. Matching the escaped spelling against the
  // document's keys found nothing, and generation stopped on an unresolvable ref.
  it('percent-decodes a pointer token before matching it', () => {
    const schema = { $defs: { 'percent%field': { type: 'string' }, 'foo"bar': { type: 'number' } } }

    expect(resolveRef('#/$defs/percent%25field', schema)).toEqual({ type: 'string' })
    expect(resolveRef('#/$defs/foo%22bar', schema)).toEqual({ type: 'number' })
  })

  it('leaves an undecodable token alone rather than throwing', () => {
    // `100% sure` is a naming choice, not a malformed escape to report.
    const schema = { $defs: { '100% sure': { type: 'boolean' } } }

    expect(resolveRef('#/$defs/100% sure', schema)).toEqual({ type: 'boolean' })
  })

  // `""` is a legal member name: `#/$defs//$defs/` addresses the `""` definition
  // nested inside the `""` definition. Filtering empty parts out walked to the
  // wrong node, or to none at all.
  it('keeps empty pointer tokens', () => {
    const schema = { $defs: { '': { $defs: { '': { type: 'number' } } } } }

    expect(resolveRef('#/$defs//$defs/', schema)).toEqual({ type: 'number' })
  })

  // Every document that writes `#/` means the root, and the rest of the pipeline
  // already reads it that way.
  it('treats "#/" as the whole document', () => {
    const schema = { $defs: { a: { type: 'object' } } }

    expect(resolveRef('#/', schema)).toEqual(schema)
  })

  // `in` walks the prototype chain, so this used to resolve to `Object.prototype`
  // and the walker happily generated a file for it.
  it('does not resolve a pointer into Object.prototype', () => {
    const schema = { $defs: { a: { type: 'object' } } }

    expect(resolveRef('#/__proto__', schema)).toBeUndefined()
    expect(resolveRef('#/constructor/prototype', schema)).toBeUndefined()
    expect(resolveRef('#/$defs/a/toString', schema)).toBeUndefined()
  })
})
