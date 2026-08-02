import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validate } from '@amritk/runtime-validators'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { bindsAtEvaluationTime, inliningKeepsScope } from './dynamic-scope'
import { resolveRefs } from './resolve-refs'
import { resolveRefsFromFile } from './resolve-refs-from-file'

// A `$dynamicRef` binds at evaluation time to the outermost `$dynamicAnchor`
// along the dynamic scope, so inlining it can only ever guess at one of the
// targets it may reach. Where the binding is not decidable statically the
// resolver keeps the keyword — and the anchors and `$id` scopes it needs to
// resolve later — instead of collapsing it to a wrong answer.
describe('dynamic-scope', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'resolve-refs-dynamic-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('keeps a $dynamicRef whose anchor name is declared more than once', () => {
    const { resolved, errors } = resolveRefs({
      $id: 'https://example.com/root',
      $ref: 'list',
      $defs: {
        foo: { $dynamicAnchor: 'items', type: 'string' },
        list: {
          $id: 'list',
          type: 'array',
          items: { $dynamicRef: '#items' },
          $defs: { items: { $dynamicAnchor: 'items' } },
        },
      },
    })

    // Two `items` anchors, so which one applies depends on how evaluation got
    // here — the keyword stays for the validator to answer.
    const inlined = (resolved as { allOf: { items: unknown }[] }).allOf[0]
    expect(inlined?.items).toEqual({ $dynamicRef: '#items' })
    // A kept reference is not a failure, so it is not on `errors`.
    expect(errors).toEqual([])
  })

  it('leaves the $dynamicAnchors and $id scopes a kept $dynamicRef binds against intact', () => {
    const { resolved } = resolveRefs({
      $id: 'https://example.com/root',
      $ref: 'list',
      $defs: {
        foo: { $dynamicAnchor: 'items', type: 'string' },
        list: {
          $id: 'list',
          type: 'array',
          items: { $dynamicRef: '#items' },
          $defs: { items: { $dynamicAnchor: 'items' } },
        },
      },
    })

    const output = resolved as {
      $defs: { foo: { $dynamicAnchor: string }; list: { $id: string } }
      allOf: { $id: string; $defs: { items: { $dynamicAnchor: string } } }[]
    }
    // The outer anchor evaluation would actually bind to...
    expect(output.$defs.foo.$dynamicAnchor).toBe('items')
    // ...and the inner one that satisfies the bookending requirement, still
    // inside the resource whose `$id` scopes it.
    expect(output.allOf[0]?.$id).toBe('list')
    expect(output.allOf[0]?.$defs.items.$dynamicAnchor).toBe('items')
  })

  it('inlines a $dynamicRef whose anchor name is declared exactly once', () => {
    const { resolved, errors } = resolveRefs({
      $id: 'https://example.com/root',
      type: 'array',
      items: { $dynamicRef: '#items' },
      $defs: { foo: { $dynamicAnchor: 'items', type: 'string' } },
    })

    // One candidate anchor document-wide means the dynamic lookup has nothing
    // to choose between, so the static answer is the only answer.
    expect((resolved as { items: unknown }).items).toEqual({ $dynamicAnchor: 'items', type: 'string' })
    expect(errors).toEqual([])
  })

  it('inlines a pointer-form $dynamicRef, which the spec says is a plain $ref', () => {
    const { resolved, errors } = resolveRefs({
      $defs: {
        items: { $dynamicAnchor: 'items', type: 'number' },
        other: { $dynamicAnchor: 'items', type: 'string' },
      },
      items: { $dynamicRef: '#/$defs/items' },
    })

    // `items` is ambiguous as an *anchor*, but this ref names a pointer, so
    // there is no anchor to late-bind to.
    expect((resolved as { items: unknown }).items).toEqual({ $dynamicAnchor: 'items', type: 'number' })
    expect(errors).toEqual([])
  })

  it('keeps a $ref that would move a kept $dynamicRef out of the resource scoping it', () => {
    const { resolved, errors } = resolveRefs({
      $id: 'https://example.com/base',
      $ref: 'first#/$defs/stuff',
      $defs: {
        first: { $id: 'first', $defs: { stuff: { $dynamicRef: '#length' } } },
        second: { $id: 'second', $defs: { length: { $dynamicAnchor: 'length', maxLength: 2 } } },
        third: { $id: 'third', $defs: { length: { $dynamicAnchor: 'length', maxLength: 3 } } },
      },
    })

    // Inlining `first#/$defs/stuff` would drop the `first` resource out of the
    // dynamic scope — it is registered even though nothing binds to it — so the
    // ref is kept alongside the `$dynamicRef` it carries.
    expect((resolved as { $ref: string }).$ref).toBe('first#/$defs/stuff')
    expect(errors).toEqual([])
  })

  it('keeps a $ref that would move a $dynamicAnchor into another resource', () => {
    const { resolved, errors } = resolveRefs({
      $id: 'https://example.com/root',
      properties: { x: { $ref: 'inner#/$defs/holder' } },
      $defs: {
        outer: { $dynamicAnchor: 'meta', type: 'string' },
        inner: {
          $id: 'inner',
          $defs: {
            holder: { $dynamicAnchor: 'meta', $ref: '#/$defs/plain' },
            plain: { type: 'object' },
          },
        },
      },
    })

    // The anchor is scaffolding even though the node carrying it is a reference:
    // copied into the root resource it would become a binding target the author
    // never put there.
    expect((resolved as { properties: { x: { $ref: string } } }).properties.x.$ref).toBe('inner#/$defs/holder')
    expect(errors).toEqual([])
  })

  it('inlines a $ref to a resource root, whose $id travels with the copy', () => {
    const { resolved, errors } = resolveRefs({
      $id: 'https://example.com/derived',
      $ref: './base',
      $defs: {
        derived: { $dynamicAnchor: 'addons', properties: { bar: { type: 'string' } } },
        base: {
          $id: './base',
          $dynamicRef: '#addons',
          $defs: { defaultAddons: { $dynamicAnchor: 'addons' } },
        },
      },
    })

    // The target carries the `$id` that defines its resource, so the copy
    // re-establishes the same scope and the kept `$dynamicRef` still sees it.
    const output = resolved as { $ref?: string; allOf: { $id: string; $dynamicRef: string }[] }
    expect(output.$ref).toBeUndefined()
    expect(output.allOf[0]?.$id).toBe('./base')
    expect(output.allOf[0]?.$dynamicRef).toBe('#addons')
    expect(errors).toEqual([])
  })

  it('resolves to a document that accepts exactly what the original did', () => {
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://example.com/typical-dynamic-resolution/root',
      $ref: 'list',
      $defs: {
        foo: { $dynamicAnchor: 'items', type: 'string' },
        list: {
          $id: 'list',
          type: 'array',
          items: { $dynamicRef: '#items' },
          $defs: { items: { $dynamicAnchor: 'items' } },
        },
      },
    }
    const { resolved } = resolveRefs(schema)

    // The point of keeping the keyword: evaluation binds `#items` to the root's
    // `string` anchor, which inlining the inner (empty) one would have lost.
    expect(validate(resolved)(['foo', 'bar'])).toBe(true)
    expect(validate(resolved)(['foo', 42])).not.toBe(true)
  })

  it('does not stamp a kept reference in the origin map', () => {
    const { resolved, origins } = resolveRefs(
      {
        $id: 'https://example.com/root',
        $ref: 'list',
        $defs: {
          foo: { $dynamicAnchor: 'items', type: 'string' },
          list: {
            $id: 'list',
            items: { $dynamicRef: '#items' },
            $defs: { items: { $dynamicAnchor: 'items' } },
          },
        },
      },
      { trackOrigins: true },
    )

    // Nothing was inlined in its place, so there is no origin to record — the
    // node is the author's own, not a copy of a definition elsewhere.
    const kept = (resolved as { allOf: { items: object }[] }).allOf[0]?.items as object
    expect(origins?.has(kept)).toBe(false)
  })

  it('keeps a $dynamicRef for a single-document resolve from disk', async () => {
    const file = join(dir, 'root.json')
    writeFileSync(
      file,
      JSON.stringify({
        $id: 'https://example.com/root',
        $ref: 'list',
        $defs: {
          foo: { $dynamicAnchor: 'items', type: 'string' },
          list: {
            $id: 'list',
            items: { $dynamicRef: '#items' },
            $defs: { items: { $dynamicAnchor: 'items' } },
          },
        },
      }),
    )

    const { resolved, errors } = await resolveRefsFromFile(file)

    // A resolve that never left the root document produces the same output the
    // in-memory resolver does.
    expect((resolved as { allOf: { items: unknown }[] }).allOf[0]?.items).toEqual({ $dynamicRef: '#items' })
    expect(errors).toEqual([])
  })

  it('inlines a $dynamicRef when several documents are flattened into one', async () => {
    const root = join(dir, 'root.json')
    const other = join(dir, 'other.json')
    writeFileSync(
      root,
      JSON.stringify({
        $id: 'https://example.com/root',
        properties: { extra: { $ref: './other.json' } },
        items: { $dynamicRef: '#items' },
        $defs: {
          foo: { $dynamicAnchor: 'items', type: 'string' },
          bar: { $dynamicAnchor: 'items', type: 'number' },
        },
      }),
    )
    writeFileSync(other, JSON.stringify({ type: 'boolean' }))

    const { resolved, errors } = await resolveRefsFromFile(root)

    // Bundling several files into one leaves no per-document scope for a kept
    // `$dynamicRef` to bind against, so this resolver keeps inlining there.
    expect((resolved as { items: unknown }).items).toEqual({ $dynamicAnchor: 'items', type: 'string' })
    expect(errors).toEqual([])
  })

  it('treats only an ambiguous anchor fragment as evaluation-time bound', () => {
    const ambiguous = new Set(['items'])

    expect(bindsAtEvaluationTime('$dynamicRef', '#items', ambiguous)).toBe(true)
    expect(bindsAtEvaluationTime('$dynamicRef', 'other#items', ambiguous)).toBe(true)
    // A pointer fragment, an absent fragment, and a name nobody redeclares are
    // all decidable now.
    expect(bindsAtEvaluationTime('$dynamicRef', '#/$defs/items', ambiguous)).toBe(false)
    expect(bindsAtEvaluationTime('$dynamicRef', 'list', ambiguous)).toBe(false)
    expect(bindsAtEvaluationTime('$dynamicRef', '#other', ambiguous)).toBe(false)
    // `$ref` and `$recursiveRef` never take this path.
    expect(bindsAtEvaluationTime('$ref', '#items', ambiguous)).toBe(false)
  })

  it('recognises when an inlined copy lands under the base it was defined with', () => {
    // Same resource: nothing enters or leaves the dynamic scope.
    expect(inliningKeepsScope({ type: 'string' }, 'https://example.com/a', 'https://example.com/a')).toBe(true)
    // The target carries the `$id` defining its resource, and it still resolves
    // to the same URI from where the copy lands.
    expect(inliningKeepsScope({ $id: 'b' }, 'https://example.com/a', 'https://example.com/b')).toBe(true)
    // A ref pointing *into* another resource leaves that resource behind.
    expect(inliningKeepsScope({ type: 'string' }, 'https://example.com/a', 'https://example.com/b')).toBe(false)
    // A boolean schema carries no `$id` to re-establish anything with.
    expect(inliningKeepsScope(true, 'https://example.com/a', 'https://example.com/b')).toBe(false)
  })
})
