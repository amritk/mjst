import { describe, expect, it } from 'vitest'

import { pointerToPath, resolveSourceOrigin, resolveSourceOriginFromMap, resolveSourcePath } from './pointers'
import type { IDocumentRegistry, IOriginMap, ISourceDocument, JsonPath } from './types'

describe('pointerToPath', () => {
  it('returns the root path for #', () => {
    expect(pointerToPath('#')).toEqual([])
  })

  it('returns undefined for an external ref', () => {
    expect(pointerToPath('./ext.yaml#/foo')).toBeUndefined()
  })

  it('decodes JSON-pointer escapes and normalizes numeric segments', () => {
    expect(pointerToPath('#/a~1b/~0c/0')).toEqual(['a/b', '~c', 0])
  })

  it('percent-decodes segments, matching the fragment decoder', () => {
    // Pointers arrive inside URI-reference `$ref`s, so `%20` must decode to a space.
    expect(pointerToPath('#/paths/~1users~1%7Bid%7D')).toEqual(['paths', '/users/{id}'])
  })
})

/** A minimal registry: `resolveSourceOrigin` only reads each document's `data`. */
function registry(rootLocation: string, docs: Record<string, unknown>): IDocumentRegistry {
  const map = new Map<string, ISourceDocument>(
    Object.entries(docs).map(([location, data]) => [location, { data, getLocationForJsonPath: () => undefined }]),
  )
  return { rootLocation, get: (location) => map.get(location) }
}

describe('resolveSourcePath (internal refs, single document)', () => {
  it('follows an internal `$ref` to its target', () => {
    const root = { defs: { X: { type: 'string' } }, a: { $ref: '#/defs/X' } }
    expect(resolveSourcePath(root, ['a'])).toEqual(['defs', 'X'])
    expect(resolveSourcePath(root, ['a', 'type'])).toEqual(['defs', 'X', 'type'])
  })
})

describe('resolveSourceOrigin (cross-document)', () => {
  it('keeps internal-ref findings in the root document', () => {
    const root = { defs: { X: { type: 'string' } }, a: { $ref: '#/defs/X' } }
    const sources = registry('/root.yaml', { '/root.yaml': root })
    expect(resolveSourceOrigin(sources, ['a', 'type'])).toEqual({
      location: '/root.yaml',
      path: ['defs', 'X', 'type'],
    })
  })

  it('attributes a finding to the external file the node came from', () => {
    const root = { a: { $ref: './ext.yaml#/foo/bar' } }
    const ext = { foo: { bar: { baz: 1 } } }
    const sources = registry('/dir/root.yaml', { '/dir/root.yaml': root, '/dir/ext.yaml': ext })
    expect(resolveSourceOrigin(sources, ['a', 'baz'])).toEqual({
      location: '/dir/ext.yaml',
      path: ['foo', 'bar', 'baz'],
    })
  })

  it('follows a whole-file `$ref` (no fragment) to the external file root', () => {
    const root = { a: { $ref: './ext.yaml' } }
    const ext = { type: 'array' }
    const sources = registry('/dir/root.yaml', { '/dir/root.yaml': root, '/dir/ext.yaml': ext })
    expect(resolveSourceOrigin(sources, ['a', 'type'])).toEqual({
      location: '/dir/ext.yaml',
      path: ['type'],
    })
  })

  it('chains through a ref in one external file into another', () => {
    const root = { a: { $ref: './a.yaml#/x' } }
    const a = { x: { $ref: './b.yaml#/y' } }
    const b = { y: { leaf: true } }
    const sources = registry('/d/root.yaml', {
      '/d/root.yaml': root,
      '/d/a.yaml': a,
      '/d/b.yaml': b,
    })
    expect(resolveSourceOrigin(sources, ['a', 'leaf'])).toEqual({
      location: '/d/b.yaml',
      path: ['y', 'leaf'],
    })
  })

  it('stops at the last known location when the target file is absent', () => {
    const root = { a: { $ref: './missing.yaml#/foo' } }
    const sources = registry('/d/root.yaml', { '/d/root.yaml': root })
    const origin = resolveSourceOrigin(sources, ['a'] as JsonPath)
    expect(origin.location).toBe('/d/root.yaml')
  })
})

describe('resolveSourceOriginFromMap (resolver-supplied origins)', () => {
  // The map is keyed by the node objects in the *resolved* tree, mirroring the
  // identity-keyed WeakMap the resolver produces with `trackOrigins`.
  it('keeps unstamped (root) nodes attributed to the root document', () => {
    const resolved = { info: { contact: {} } }
    const origins: IOriginMap = new Map()
    expect(resolveSourceOriginFromMap(resolved, origins, '/root.yaml', ['info', 'contact'])).toEqual({
      location: '/root.yaml',
      path: ['info', 'contact'],
    })
  })

  it('re-bases onto a stamped node and appends the remaining path', () => {
    const foo = { bar: { baz: 1 } }
    const resolved = { a: foo }
    const origins: IOriginMap = new Map([[foo, { location: '/dir/pet.yaml', pointer: ['foo'] }]])
    expect(resolveSourceOriginFromMap(resolved, origins, '/dir/root.yaml', ['a', 'bar', 'baz'])).toEqual({
      location: '/dir/pet.yaml',
      path: ['foo', 'bar', 'baz'],
    })
  })

  it('handles a stamp that appears partway down the path', () => {
    const response = { schema: { type: 'array' } }
    const resolved = { paths: { '/p': { get: response } } }
    const origins: IOriginMap = new Map([[response, { location: '/ext.yaml', pointer: ['Resp'] }]])
    expect(
      resolveSourceOriginFromMap(resolved, origins, '/root.yaml', ['paths', '/p', 'get', 'schema', 'type']),
    ).toEqual({ location: '/ext.yaml', path: ['Resp', 'schema', 'type'] })
  })

  it('matches the unresolved walk for a shared internal-ref target', () => {
    // `a` and `defs.X` are the same object, as the resolver's cache would share them.
    const target = { type: 'string' }
    const resolved = { defs: { X: target }, a: target }
    const origins: IOriginMap = new Map([[target, { location: '/root.yaml', pointer: ['defs', 'X'] }]])
    expect(resolveSourceOriginFromMap(resolved, origins, '/root.yaml', ['a', 'type'])).toEqual({
      location: '/root.yaml',
      path: ['defs', 'X', 'type'],
    })
  })
})
