import { describe, expect, it } from 'vitest'

import { assertIdScopes } from './assert-id-scopes'

describe('assert-id-scopes', () => {
  // The misresolution the check exists for: `#/$defs/t` inside the embedded
  // resource means the *inner* `t`, and the inner resource has no `t` — so the
  // ref is unresolvable, but navigating from the document root quietly hands
  // back the outer one instead: a different type, exit 0.
  it('rejects a fragment ref that names nothing inside the resource it belongs to', () => {
    const schema = {
      $defs: {
        t: { type: 'string' as const },
        inner: {
          $id: 'https://example.com/inner',
          $defs: { u: { type: 'number' as const } },
          properties: { value: { $ref: '#/$defs/t' } },
        },
      },
    }

    expect(() => assertIdScopes(schema)).toThrow(/names nothing inside it/)
  })

  it('names the offending $id and ref so the report is actionable', () => {
    const schema = {
      $defs: {
        inner: {
          $id: 'https://example.com/inner',
          $anchor: 'thing',
          properties: { value: { $ref: '#missing' } },
        },
      },
    }

    expect(() => assertIdScopes(schema)).toThrow(/https:\/\/example\.com\/inner.*#missing/s)
  })

  // A `$dynamicRef` addresses its target the same way, so it is screened too.
  it('rejects an unresolvable fragment $dynamicRef inside an embedded resource', () => {
    const schema = {
      $defs: {
        inner: {
          $id: 'https://example.com/inner',
          $defs: { t: { $dynamicAnchor: 'other' } },
          properties: { value: { $dynamicRef: '#thing' } },
        },
      },
    }

    expect(() => assertIdScopes(schema)).toThrow(/names nothing inside it/)
  })

  // The whole point of base-URI resolution: this ref *does* name the inner `t`,
  // so it is no longer ambiguous and must not fail a build.
  it('accepts a fragment ref the embedded resource actually declares', () => {
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

    expect(() => assertIdScopes(schema)).not.toThrow()
  })

  it('accepts an anchor ref the embedded resource declares', () => {
    const schema = {
      $defs: {
        inner: {
          $id: 'https://example.com/inner',
          $anchor: 'thing',
          properties: { value: { $ref: '#thing' } },
        },
      },
    }

    expect(() => assertIdScopes(schema)).not.toThrow()
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

  it('accepts a document that declares no $id at all', () => {
    const schema = {
      $defs: { t: { type: 'string' as const } },
      properties: { value: { $ref: '#/$defs/t' } },
    }

    expect(() => assertIdScopes(schema)).not.toThrow()
  })

  it('accepts a boolean schema', () => {
    expect(() => assertIdScopes(true)).not.toThrow()
  })
})
