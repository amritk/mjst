import { describe, expect, it } from 'vitest'

import { assertIdScopes } from './assert-id-scopes'

describe('assert-id-scopes', () => {
  // The misresolution the check exists for: `#/$defs/t` inside the embedded
  // resource means the *inner* `t`, but resolution navigates from the document
  // root and quietly hands back the outer one — a different type, exit 0.
  it('rejects a fragment ref inside an embedded resource that has its own $defs', () => {
    const schema = {
      $defs: {
        t: { type: 'string' as const },
        inner: {
          $id: 'https://example.com/inner',
          $defs: { t: { type: 'number' as const } },
          properties: { value: { $ref: '#/$defs/t' } },
        },
      },
    }

    expect(() => assertIdScopes(schema)).toThrow(/\$id base-URI scoping is not supported/)
  })

  it('names the offending $id and ref so the report is actionable', () => {
    const schema = {
      $defs: {
        inner: {
          $id: 'https://example.com/inner',
          $anchor: 'thing',
          properties: { value: { $ref: '#thing' } },
        },
      },
    }

    expect(() => assertIdScopes(schema)).toThrow(/https:\/\/example\.com\/inner.*#thing/s)
  })

  // The root's `$id` is the document's base URI, not a nested scope.
  it('accepts a document whose only $id is on the root', () => {
    const schema = {
      $id: 'https://example.com/root',
      $defs: { t: { type: 'string' as const } },
      properties: { value: { $ref: '#/$defs/t' } },
    }

    expect(() => assertIdScopes(schema)).not.toThrow()
  })

  // A decorative `$id` with nothing local to point at has only one possible
  // reading, so it keeps working rather than failing a build for no reason.
  it('accepts a nested $id that declares no targets of its own', () => {
    const schema = {
      $defs: {
        t: { type: 'string' as const },
        inner: { $id: 'https://example.com/inner', properties: { value: { $ref: '#/$defs/t' } } },
      },
    }

    expect(() => assertIdScopes(schema)).not.toThrow()
  })

  it('accepts an embedded resource that contains no fragment refs', () => {
    const schema = {
      $defs: {
        inner: {
          $id: 'https://example.com/inner',
          $defs: { t: { type: 'number' as const } },
          properties: { value: { $ref: 'https://example.com/other.json' } },
        },
      },
    }

    expect(() => assertIdScopes(schema)).not.toThrow()
  })

  it('ignores an $id that is only example data', () => {
    const schema = {
      $defs: {
        t: { type: 'string' as const },
        a: { type: 'object' as const, examples: [{ $id: 'https://example.com/x', $ref: '#/$defs/t' }] },
      },
    }

    expect(() => assertIdScopes(schema)).not.toThrow()
  })

  it('accepts a boolean schema', () => {
    expect(() => assertIdScopes(true)).not.toThrow()
  })
})
