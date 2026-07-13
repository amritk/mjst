import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveRefs } from './resolve-refs'
import { clearRemoteCache, resolveRefsFromFile } from './resolve-refs-from-file'

// `$id` base-URI scoping (see resource-registry.ts): refs whose URI matches an
// embedded resource's `$id` resolve internally, and anchors bind within the
// resource that declares them before any document-global fallback.
describe('$id base-URI scoping', () => {
  it('resolves a $ref to an embedded resource by its absolute $id (bundle pattern)', () => {
    const { resolved, errors } = resolveRefs({
      $id: 'https://example.com/root.json',
      properties: { addr: { $ref: 'https://example.com/address.json' } },
      $defs: { Address: { $id: 'https://example.com/address.json', type: 'object' } },
    })

    expect(errors).toEqual([])
    expect((resolved as { properties: { addr: { type: string } } }).properties.addr.type).toBe('object')
  })

  it('resolves a relative $ref against the root $id', () => {
    const { resolved, errors } = resolveRefs({
      $id: 'https://example.com/schemas/root.json',
      properties: { addr: { $ref: 'address.json' } },
      $defs: { Address: { $id: 'address.json', type: 'object' } },
    })

    expect(errors).toEqual([])
    expect((resolved as { properties: { addr: { type: string } } }).properties.addr.type).toBe('object')
  })

  it('resolves a pointer fragment within an embedded resource, not the document root', () => {
    const { resolved, errors } = resolveRefs({
      $id: 'https://example.com/root.json',
      properties: { item: { $ref: 'https://example.com/list.json#/$defs/entry' } },
      $defs: {
        List: {
          $id: 'https://example.com/list.json',
          $defs: { entry: { type: 'string' } },
        },
      },
    })

    expect(errors).toEqual([])
    expect((resolved as { properties: { item: unknown } }).properties.item).toEqual({ type: 'string' })
  })

  it('binds duplicate anchor names to the resource that declares them', () => {
    const { resolved, errors } = resolveRefs({
      $defs: {
        a: {
          $id: 'https://example.com/a.json',
          properties: { it: { $ref: '#item' } },
          $defs: { i: { $anchor: 'item', type: 'string' } },
        },
        b: {
          $id: 'https://example.com/b.json',
          properties: { it: { $ref: '#item' } },
          $defs: { i: { $anchor: 'item', type: 'number' } },
        },
      },
    })

    expect(errors).toEqual([])
    const defs = (resolved as { $defs: Record<string, { properties: { it: { type: string } } }> }).$defs
    // Before scoping, both bound to the first `item` anchor in document order.
    expect(defs['a']?.properties.it.type).toBe('string')
    expect(defs['b']?.properties.it.type).toBe('number')
  })

  it('prefers a $dynamicAnchor over an $anchor of the same name for $dynamicRef, per scope', () => {
    const { resolved, errors } = resolveRefs({
      $defs: {
        res: {
          $id: 'https://example.com/res.json',
          properties: { d: { $dynamicRef: '#node' }, s: { $ref: '#node' } },
          $defs: {
            plain: { $anchor: 'node', type: 'string' },
            dynamic: { $dynamicAnchor: 'node', type: 'number' },
          },
        },
      },
    })

    expect(errors).toEqual([])
    const res = (resolved as { $defs: { res: { properties: { d: { type: string }; s: { type: string } } } } }).$defs.res
    expect(res.properties.d.type).toBe('number')
    // The static $ref binds to the plain $anchor declared first.
    expect(res.properties.s.type).toBe('string')
  })

  it('falls back to a document-global anchor search for anchors in sibling resources', () => {
    // Spec-strictly this anchor is not visible from the referencing resource;
    // the fallback keeps previously-working documents resolving.
    const { resolved, errors } = resolveRefs({
      $defs: {
        a: { $id: 'https://example.com/a.json', properties: { it: { $ref: '#elsewhere' } } },
        b: { $anchor: 'elsewhere', type: 'boolean' },
      },
    })

    expect(errors).toEqual([])
    const defs = (resolved as { $defs: { a: { properties: { it: { type: string } } } } }).$defs
    expect(defs.a.properties.it.type).toBe('boolean')
  })

  it('leaves a URI ref matching no embedded resource untouched (external)', () => {
    const { resolved, errors } = resolveRefs({
      $id: 'https://example.com/root.json',
      properties: { other: { $ref: 'https://elsewhere.example.com/s.json#/Foo' } },
    })

    expect(errors).toEqual([])
    expect((resolved as { properties: { other: unknown } }).properties.other).toEqual({
      $ref: 'https://elsewhere.example.com/s.json#/Foo',
    })
  })

  describe('from-file resolver', () => {
    let dir: string

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'resolve-refs-id-'))
      clearRemoteCache()
    })

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true })
      vi.restoreAllMocks()
    })

    it('resolves an $id-bundled ref without fetching, even for an https $id', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      writeFileSync(
        join(dir, 'bundle.json'),
        JSON.stringify({
          $id: 'https://example.com/root.json',
          properties: { addr: { $ref: 'https://example.com/address.json' } },
          $defs: { Address: { $id: 'https://example.com/address.json', type: 'object' } },
        }),
      )

      const { resolved, errors } = await resolveRefsFromFile(join(dir, 'bundle.json'))

      expect(errors).toEqual([])
      expect(resolved).toMatchObject({ properties: { addr: { type: 'object' } } })
      // The embedded resource satisfied the ref — no network involved.
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('still loads sibling files by document location, not by $id', async () => {
      // A root `$id` naming a remote URL must not turn a local sibling-file ref
      // into a network fetch — retrieval stays location-based.
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      writeFileSync(join(dir, 'other.json'), JSON.stringify({ Foo: { type: 'string' } }))
      writeFileSync(
        join(dir, 'root.json'),
        JSON.stringify({
          $id: 'https://example.com/root.json',
          properties: { foo: { $ref: './other.json#/Foo' } },
        }),
      )

      const { resolved, errors } = await resolveRefsFromFile(join(dir, 'root.json'))

      expect(errors).toEqual([])
      expect(resolved).toMatchObject({ properties: { foo: { type: 'string' } } })
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('scopes anchors per resource across a loaded document', async () => {
      writeFileSync(
        join(dir, 'root.json'),
        JSON.stringify({
          $defs: {
            a: {
              $id: 'https://example.com/a.json',
              properties: { it: { $ref: '#item' } },
              $defs: { i: { $anchor: 'item', type: 'string' } },
            },
            b: {
              $id: 'https://example.com/b.json',
              properties: { it: { $ref: '#item' } },
              $defs: { i: { $anchor: 'item', type: 'number' } },
            },
          },
        }),
      )

      const { resolved, errors } = await resolveRefsFromFile(join(dir, 'root.json'))

      expect(errors).toEqual([])
      const defs = (resolved as { $defs: Record<string, { properties: { it: { type: string } } }> }).$defs
      expect(defs['a']?.properties.it.type).toBe('string')
      expect(defs['b']?.properties.it.type).toBe('number')
    })
  })
})
