import { describe, expect, it } from 'vitest'

import { buildResourceRegistry, type ResourceRegistry } from './build-resource-registry'
import { resolveScopedRef } from './resolve-scoped-ref'

/** The document every case below resolves against — one resource per ref form. */
const DOCUMENT = {
  $id: 'http://example.com/root.json',
  $defs: {
    sibling: { $id: 'sibling.json', $defs: { inner: { type: 'string' } }, $anchor: 'here' },
    folder: { $id: 'http://example.com/nested/deep.json', type: 'number' },
    urn: { $id: 'urn:uuid:deadbeef-1234-0000-0000-4321feebdaed', $defs: { bar: { type: 'boolean' } } },
  },
}

const registry = buildResourceRegistry(DOCUMENT) as ResourceRegistry

describe('resolve-scoped-ref', () => {
  it('resolves a relative ref against the base in scope', () => {
    expect(resolveScopedRef(registry, 'sibling.json', 'http://example.com/root.json')?.pointer).toBe('/$defs/sibling')
  })

  it('resolves an absolute ref', () => {
    expect(resolveScopedRef(registry, 'http://example.com/nested/deep.json', registry.rootBase)?.pointer).toBe(
      '/$defs/folder',
    )
  })

  it('resolves an absolute-path ref against the base host', () => {
    expect(resolveScopedRef(registry, '/nested/deep.json', 'http://example.com/root.json')?.pointer).toBe(
      '/$defs/folder',
    )
  })

  it('resolves a URN ref and a pointer inside it', () => {
    const urn = 'urn:uuid:deadbeef-1234-0000-0000-4321feebdaed'
    expect(resolveScopedRef(registry, urn, registry.rootBase)?.pointer).toBe('/$defs/urn')
    expect(resolveScopedRef(registry, `${urn}#/$defs/bar`, registry.rootBase)?.pointer).toBe('/$defs/urn/$defs/bar')
  })

  it('resolves an anchor inside a named resource', () => {
    expect(resolveScopedRef(registry, 'sibling.json#here', registry.rootBase)?.pointer).toBe('/$defs/sibling')
  })

  // The misresolution the registry exists to fix: inside an embedded resource,
  // `#/$defs/inner` means *that resource's* `$defs`, not the document's.
  it('resolves a bare fragment against the enclosing resource, not the document root', () => {
    expect(resolveScopedRef(registry, '#/$defs/inner', 'http://example.com/sibling.json')?.pointer).toBe(
      '/$defs/sibling/$defs/inner',
    )
    expect(resolveScopedRef(registry, '#/$defs/inner', registry.rootBase)?.pointer).toBe('/$defs/inner')
  })

  it('reports the base refs written inside the target resolve against', () => {
    expect(resolveScopedRef(registry, 'sibling.json#/$defs/inner', registry.rootBase)?.base).toBe(
      'http://example.com/sibling.json',
    )
    expect(resolveScopedRef(registry, '#/$defs/folder', registry.rootBase)?.base).toBe(
      'http://example.com/nested/deep.json',
    )
  })

  it('returns undefined for a URI no resource in the document claims', () => {
    expect(resolveScopedRef(registry, 'http://elsewhere.example/other.json', registry.rootBase)).toBeUndefined()
  })

  it('returns undefined for an anchor the resource does not declare', () => {
    expect(resolveScopedRef(registry, 'sibling.json#missing', registry.rootBase)).toBeUndefined()
  })

  it('returns undefined when the ref and base do not parse as a URI', () => {
    expect(resolveScopedRef(registry, 'not a uri', ':::')).toBeUndefined()
  })
})
