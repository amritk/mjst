import { describe, expect, it } from 'vitest'

import { resolveRefs } from './resolve-refs'

describe('resolve-refs', () => {
  it('inlines an internal $ref', () => {
    const { resolved, errors } = resolveRefs({
      type: 'object',
      properties: { contact: { $ref: '#/$defs/contact' } },
      $defs: { contact: { type: 'string' } },
    })

    expect(errors).toEqual([])
    expect(resolved).toMatchObject({ properties: { contact: { type: 'string' } } })
  })

  it('reports an unresolvable internal pointer instead of inlining undefined', () => {
    const { resolved, errors } = resolveRefs({
      properties: { a: { $ref: '#/$defs/missing' } },
    })

    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toMatch(/Cannot resolve internal \$ref/)
    // The original $ref node is preserved rather than replaced with `undefined`.
    expect((resolved as { properties: { a: unknown } }).properties.a).toEqual({ $ref: '#/$defs/missing' })
  })

  it('breaks a self-referential cycle by keeping the reference', () => {
    const { resolved, errors } = resolveRefs({
      $defs: { node: { type: 'object', properties: { next: { $ref: '#/$defs/node' } } } },
      properties: { head: { $ref: '#/$defs/node' } },
    })

    expect(errors).toEqual([])
    const head = (resolved as { properties: { head: { properties: { next: unknown } } } }).properties.head
    // The first level resolves; the recursive self-reference keeps its `$ref`,
    // which still resolves within the output (`$defs.node` is preserved), so
    // the recursive branch survives instead of collapsing to `{}`.
    expect(head.properties.next).toEqual({ $ref: '#/$defs/node' })
  })

  it('breaks a mutual cycle (A → B → A) without infinite recursion', () => {
    const { resolved } = resolveRefs({
      $defs: {
        a: { type: 'object', properties: { b: { $ref: '#/$defs/b' } } },
        b: { type: 'object', properties: { a: { $ref: '#/$defs/a' } } },
      },
      properties: { root: { $ref: '#/$defs/a' } },
    })

    // Resolution terminates; whichever leg re-enters the cycle first keeps its
    // `$ref` rather than looping forever — and that ref still resolves against
    // the preserved `$defs`, so no information is lost.
    const root = (resolved as { properties: { root: { type: string; properties: { b: unknown } } } }).properties.root
    expect(root.type).toBe('object')
    expect(root.properties.b).toEqual({ $ref: '#/$defs/b' })
    // The kept ref's target survives in the output with its full shape.
    const defs = (resolved as { $defs: { b: { type: string; properties: { a: unknown } } } }).$defs
    expect(defs.b.type).toBe('object')
  })

  it('leaves external (non-#) refs in place but records an error', () => {
    const { resolved, errors } = resolveRefs({ properties: { pet: { $ref: 'pet.json#/Pet' } } })

    // The node is preserved (the in-memory resolver can't load other documents)…
    expect(resolved).toEqual({ properties: { pet: { $ref: 'pet.json#/Pet' } } })
    // …but the unresolved external ref is surfaced as a diagnostic.
    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toMatch(/external ref requires resolveRefsFromFile/)
  })

  it('records an error for each distinct external ref encountered', () => {
    const { errors } = resolveRefs({
      properties: {
        pet: { $ref: 'pet.json#/Pet' },
        owner: { $ref: 'https://api.example.com/owner.json' },
      },
    })

    expect(errors).toHaveLength(2)
    expect(errors.map((e) => e.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('pet.json#/Pet'),
        expect.stringContaining('https://api.example.com/owner.json'),
      ]),
    )
  })

  it('omits the origin map unless trackOrigins is set', () => {
    const result = resolveRefs({ a: { $ref: '#/$defs/x' }, $defs: { x: { type: 'string' } } })
    expect(result.origins).toBeUndefined()
  })

  it('stamps each inlined node with its in-document origin path', () => {
    const { resolved, origins } = resolveRefs(
      {
        properties: { a: { $ref: '#/$defs/x' }, b: { $ref: '#/$defs/x' } },
        $defs: { x: { type: 'object', properties: { id: { type: 'string' } } } },
      },
      { trackOrigins: true },
    )
    const tree = resolved as { properties: { a: object; b: object } }
    // Repeated refs share one object, stamped once with the definition path.
    expect(tree.properties.a).toBe(tree.properties.b)
    expect(origins?.get(tree.properties.a)).toEqual({ location: '', pointer: ['$defs', 'x'] })
  })

  it('keeps keywords sibling to a $ref by combining them in an allOf', () => {
    // JSON Schema 2020-12 applies `$ref` siblings alongside the referenced
    // schema, so inlining must not drop them.
    const { resolved } = resolveRefs({
      properties: { p: { $ref: '#/$defs/s', maxLength: 2 } },
      $defs: { s: { type: 'string' } },
    })
    expect((resolved as { properties: { p: unknown } }).properties.p).toEqual({
      maxLength: 2,
      allOf: [{ type: 'string' }],
    })
  })

  it('merges $ref siblings into an existing allOf rather than overwriting it', () => {
    const { resolved } = resolveRefs({
      root: { $ref: '#/$defs/s', allOf: [{ minLength: 1 }] },
      $defs: { s: { type: 'string' } },
    })
    expect((resolved as { root: unknown }).root).toEqual({
      allOf: [{ minLength: 1 }, { type: 'string' }],
    })
  })

  it('stamps the origin of a $ref-with-siblings wrapper node', () => {
    const { resolved, origins } = resolveRefs(
      {
        properties: { p: { $ref: '#/$defs/s', maxLength: 2 } },
        $defs: { s: { type: 'string' } },
      },
      { trackOrigins: true },
    )
    const node = (resolved as { properties: { p: object } }).properties.p
    expect(origins?.get(node)).toEqual({ location: '', pointer: ['$defs', 's'] })
  })

  it('leaves a $ref with no siblings inlined directly', () => {
    const { resolved } = resolveRefs({
      a: { $ref: '#/$defs/s' },
      $defs: { s: { type: 'string' } },
    })
    expect((resolved as { a: unknown }).a).toEqual({ type: 'string' })
  })

  it('decodes pointer escapes and array indices in origin paths', () => {
    const { resolved, origins } = resolveRefs(
      { ref: { $ref: '#/a~1b/c~0d/0' }, 'a/b': { 'c~d': [{ type: 'number' }] } },
      { trackOrigins: true },
    )
    const node = (resolved as { ref: object }).ref
    expect(origins?.get(node)).toEqual({ location: '', pointer: ['a/b', 'c~d', 0] })
  })

  it('collects an error instead of throwing on a pathologically nested document', () => {
    // 20k levels used to unwind the stack with a RangeError, breaking the
    // package's promise that errors are collected and never thrown.
    const depth = 20_000
    const document: unknown = JSON.parse('{"a":'.repeat(depth) + '1' + '}'.repeat(depth))

    const { errors } = resolveRefs(document)

    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toMatch(/exceeds the maximum depth of 512/)
  })

  it('reports the depth limit once, however many branches trip it', () => {
    // Wide and deep: one error per branch would make the error array its own
    // memory problem.
    const deep = (): unknown => JSON.parse('{"a":'.repeat(600) + '1' + '}'.repeat(600))
    const { errors } = resolveRefs({ one: deep(), two: deep(), three: deep() })

    expect(errors).toHaveLength(1)
  })

  it('resolves normally right up to the depth limit', () => {
    // A shallow document must not pay for the cap.
    const { resolved, errors } = resolveRefs(
      { a: { b: { c: { $ref: '#/$defs/x' } } }, $defs: { x: { type: 'string' } } },
      { maxDepth: 8 },
    )

    expect(errors).toEqual([])
    expect(resolved).toMatchObject({ a: { b: { c: { type: 'string' } } } })
  })

  it('leaves a $ref-shaped object inside enum alone', () => {
    // The suite calls this one "naive replacement of $ref with its destination
    // is not correct": `enum` holds instances, and this instance happens to be
    // an object with a `$ref` key. Inlining it would change the schema from
    // "matches the object `{$ref: …}`" to "matches the object `{type: string}`".
    const { resolved, errors } = resolveRefs({
      $defs: { a_string: { type: 'string' } },
      enum: [{ $ref: '#/$defs/a_string' }],
    })

    expect(errors).toEqual([])
    expect(resolved).toEqual({
      $defs: { a_string: { type: 'string' } },
      enum: [{ $ref: '#/$defs/a_string' }],
    })
  })

  it('leaves $ref-shaped objects inside const, default and examples alone', () => {
    const value = { $ref: '#/$defs/a_string' }
    const { resolved, errors } = resolveRefs({
      $defs: { a_string: { type: 'string' } },
      properties: {
        a: { const: value },
        b: { default: value },
        c: { examples: [value] },
      },
    })

    expect(errors).toEqual([])
    expect(resolved).toMatchObject({
      properties: { a: { const: value }, b: { default: value }, c: { examples: [value] } },
    })
  })

  it('resolves a $ref that points into instance data by copying the data', () => {
    // The target is a value, so it is inlined exactly as written — the `$ref`
    // key inside it is part of the data, not another hop.
    const { resolved, errors } = resolveRefs({
      $defs: { sample: { const: { $ref: '#/$defs/a_string' } }, a_string: { type: 'string' } },
      properties: { a: { $ref: '#/$defs/sample/const' } },
    })

    expect(errors).toEqual([])
    expect(resolved).toMatchObject({ properties: { a: { $ref: '#/$defs/a_string' } } })
  })

  it('resolves a definition named after a value keyword', () => {
    // The trap in the fix: under `$defs` the key `enum` is a name the author
    // chose, so its value is still a schema and its refs still resolve.
    const { resolved, errors } = resolveRefs({
      $defs: { enum: { $ref: '#/$defs/a_string' }, a_string: { type: 'string' } },
      properties: { a: { $ref: '#/$defs/enum' } },
    })

    expect(errors).toEqual([])
    expect(resolved).toMatchObject({ properties: { a: { type: 'string' } }, $defs: { enum: { type: 'string' } } })
  })

  it('resolves a $ref inside a property named after a value keyword', () => {
    const { resolved, errors } = resolveRefs({
      $defs: { a_string: { type: 'string' } },
      properties: { const: { $ref: '#/$defs/a_string' }, default: { $ref: '#/$defs/a_string' } },
    })

    expect(errors).toEqual([])
    expect(resolved).toMatchObject({ properties: { const: { type: 'string' }, default: { type: 'string' } } })
  })

  it('treats a property named $ref as a property name, not a reference', () => {
    // `properties` is keyed by property names, so `{"$ref": …}` here declares a
    // property called `$ref` — the map itself is not a reference node.
    const { resolved, errors } = resolveRefs({
      $defs: { 'is-string': { type: 'string' } },
      properties: { $ref: { $ref: '#/$defs/is-string' } },
    })

    expect(errors).toEqual([])
    expect(resolved).toMatchObject({ properties: { $ref: { type: 'string' } } })
  })

  it('ignores an $id or $anchor that is part of a value', () => {
    // An `$id` inside a default value is data: it must not register a resource
    // that a ref could then bind to.
    const { errors } = resolveRefs({
      properties: { a: { default: { $id: 'https://example.com/fake', $anchor: 'fake' } } },
      $defs: { b: { $ref: '#fake' } },
    })

    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toMatch(/Cannot resolve internal \$ref "#fake"/)
  })

  it('keeps resolving inside unrecognized keywords', () => {
    // Extension territory (OpenAPI, `x-` blocks) is not a vocabulary we model,
    // so the structural walk there stays exactly as it was.
    const { resolved, errors } = resolveRefs({
      components: { schemas: { Pet: { enum: [{ $ref: '#/$defs/a_string' }] } } },
      $defs: { a_string: { type: 'string' } },
    })

    expect(errors).toEqual([])
    expect(resolved).toMatchObject({ components: { schemas: { Pet: { enum: [{ type: 'string' }] } } } })
  })

  it('honors a caller-supplied maxDepth', () => {
    const { resolved, errors } = resolveRefs({ a: { b: { c: { d: 1 } } } }, { maxDepth: 2 })

    expect(errors[0]?.message).toMatch(/exceeds the maximum depth of 2/)
    // The subtree past the limit is handed back unresolved rather than dropped.
    expect(resolved).toMatchObject({ a: { b: { c: { d: 1 } } } })
  })
})
