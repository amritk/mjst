import { describe, expect, it } from 'vitest'

import { type RefNode, walkRefGraph } from './walk-ref-graph'

/** Collects every visited node so a test can assert what the walker produced. */
const collect = (rootSchema: Parameters<typeof walkRefGraph>[0], rootTypeName: string, typeSuffix = ''): RefNode[] => {
  const nodes: RefNode[] = []
  walkRefGraph(rootSchema, rootTypeName, { typeSuffix }, (node) => nodes.push(node))
  return nodes
}

describe('walk-ref-graph', () => {
  it('visits the root first, then each referenced definition', () => {
    const schema = {
      type: 'object',
      properties: { contact: { $ref: '#/$defs/contact' } },
      $defs: { contact: { type: 'object', properties: { email: { type: 'string' } } } },
    }

    const nodes = collect(schema, 'Document')

    expect(nodes.map((n) => ({ ref: n.ref, typeName: n.typeName, filename: n.filename, isRoot: n.isRoot }))).toEqual([
      { ref: undefined, typeName: 'Document', filename: 'document', isRoot: true },
      { ref: '#/$defs/contact', typeName: 'Contact', filename: 'contact', isRoot: false },
    ])
  })

  it('follows nested refs breadth-first and resolves each schema', () => {
    const schema = {
      properties: { user: { $ref: '#/$defs/user' } },
      $defs: {
        user: { type: 'object', properties: { address: { $ref: '#/$defs/address' } } },
        address: { type: 'object', properties: { city: { type: 'string' } } },
      },
    }

    const nodes = collect(schema, 'Document')

    expect(nodes.map((n) => n.filename)).toEqual(['document', 'user', 'address'])
    expect(nodes[2]?.schema).toEqual({ type: 'object', properties: { city: { type: 'string' } } })
  })

  it('applies the type suffix to ref-derived names but not the root', () => {
    const schema = { properties: { contact: { $ref: '#/$defs/contact' } }, $defs: { contact: { type: 'object' } } }

    const nodes = collect(schema, 'Document', 'Object')

    expect(nodes.map((n) => n.typeName)).toEqual(['Document', 'ContactObject'])
  })

  it('does not visit two refs that map to the same filename twice', () => {
    // A URI key and its short-name alias both resolve to the same definition and
    // share a filename, so only one file should be emitted.
    const schema = {
      allOf: [{ $ref: 'http://example.com/channel.json' }, { $ref: '#/$defs/channel' }],
      $defs: {
        'http://example.com/channel.json': { type: 'object' },
        channel: { type: 'object' },
      },
    }

    const filenames = collect(schema, 'Document').map((n) => n.filename)
    expect(filenames.filter((f) => f === 'channel')).toHaveLength(1)
  })

  it('seeds $dynamicAnchor definitions and rewrites $dynamicRef to $ref', () => {
    const schema = {
      type: 'object',
      properties: { payload: { $dynamicRef: '#meta' } },
      $defs: { schema: { $dynamicAnchor: 'meta', type: 'object' } },
    }

    const nodes = collect(schema, 'Document')

    // The dynamic-anchor target gets its own file even though no plain $ref points at it...
    expect(nodes.map((n) => n.filename)).toContain('schema')
    // ...and the $dynamicRef on the root is rewritten to a concrete $ref.
    const root = nodes.find((n) => n.isRoot)
    expect(root?.schema).toMatchObject({ properties: { payload: { $ref: '#/$defs/schema' } } })
  })

  // Warning and skipping left the generators emitting `parseNope` / `NopeShape`
  // for a file that was never written, so `mjst` exited 0 having produced output
  // that cannot compile (and, for validators, cannot even be imported).
  it('throws on a ref that cannot be resolved', () => {
    const schema = { properties: { missing: { $ref: '#/$defs/nope' } }, $defs: {} }

    expect(() => collect(schema, 'Document')).toThrow(/Could not resolve \$ref "#\/\$defs\/nope"/)
  })

  it('throws on an unresolvable remote ref rather than emitting a dangling import', () => {
    const schema = { properties: { x: { $ref: 'https://nope.example/x.json' } } }

    expect(() => collect(schema, 'Document')).toThrow(/https:\/\/nope\.example\/x\.json/)
  })

  it('handles circular refs (A → B → A) without infinite looping', () => {
    const schema = {
      properties: { root: { $ref: '#/$defs/a' } },
      $defs: {
        a: { type: 'object', properties: { b: { $ref: '#/$defs/b' } } },
        b: { type: 'object', properties: { a: { $ref: '#/$defs/a' } } },
      },
    }

    const nodes = collect(schema, 'Document')

    // Both defs are visited exactly once each despite the cycle.
    expect(nodes.map((n) => n.filename)).toEqual(['document', 'a', 'b'])
  })

  it('reuses cached resolution across repeated walks of the same schema object', () => {
    // The second walk should produce the same nodes from the per-root cache,
    // proving the cache does not corrupt or drop results on reuse.
    const schema = { properties: { contact: { $ref: '#/$defs/contact' } }, $defs: { contact: { type: 'object' } } }

    const first = collect(schema, 'Document').map((n) => n.filename)
    const second = collect(schema, 'Document').map((n) => n.filename)

    expect(second).toEqual(first)
  })

  it('merges an alias root into its same-named definition instead of a self-importing wrapper', () => {
    // A document that is only `$ref: '#/$defs/expr'` with root type "Expr"
    // maps to the same filename as the definition. The old behavior emitted a
    // wrapper for the root and skipped the definition, leaving expr.ts to
    // import (and redeclare) itself. The walker now hands the *resolved*
    // definition to the root node, carrying the ref for self-import exclusion.
    const schema = {
      title: 'Expr',
      $ref: '#/$defs/expr',
      $defs: {
        expr: {
          oneOf: [
            { type: 'object', properties: { kind: { const: 'lit' } }, required: ['kind'] },
            {
              type: 'object',
              properties: { kind: { const: 'add' }, left: { $ref: '#/$defs/expr' } },
              required: ['kind', 'left'],
            },
          ],
        },
      },
    }

    const nodes = collect(schema, 'Expr')

    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.filename).toBe('expr')
    expect(nodes[0]?.isRoot).toBe(true)
    expect(nodes[0]?.ref).toBe('#/$defs/expr')
    // The node carries the union definition, not the bare-$ref wrapper.
    expect(nodes[0]?.schema).toHaveProperty('oneOf')
  })

  it('keeps the wrapper for an alias root whose name does not collide', () => {
    const schema = {
      title: 'Ast',
      $ref: '#/$defs/expr',
      $defs: { expr: { type: 'object', properties: { kind: { type: 'string' } } } },
    }

    const nodes = collect(schema, 'Ast')

    expect(nodes.map((n) => ({ filename: n.filename, ref: n.ref, isRoot: n.isRoot }))).toEqual([
      { filename: 'ast', ref: undefined, isRoot: true },
      { filename: 'expr', ref: '#/$defs/expr', isRoot: false },
    ])
  })

  it('does not treat a root with shape keywords beside its $ref as an alias', () => {
    // `$ref` plus sibling keywords is a composition, not a pure alias — the
    // root keeps its own (merged) schema.
    const schema = {
      title: 'Wrapper',
      $ref: '#/$defs/expr',
      type: 'object',
      properties: { extra: { type: 'string' } },
      $defs: { expr: { type: 'object', properties: { kind: { type: 'string' } } } },
    }

    const nodes = collect(schema, 'Wrapper')

    expect(nodes[0]?.ref).toBeUndefined()
    expect(nodes[0]?.schema).toHaveProperty('properties')
  })

  it('maps a root $dynamicAnchor onto the root file so recursion resolves', () => {
    // The canonical 2020-12 recursive tree. `#node` used to bind to nothing, so
    // `children` was typed `Node[]` — the DOM interface under most tsconfigs.
    const schema = {
      $id: 'https://example.com/tree',
      $dynamicAnchor: 'node',
      type: 'object',
      properties: { data: {}, children: { type: 'array', items: { $dynamicRef: '#node' } } },
    }

    const nodes = collect(schema, 'Tree')

    // Nothing extra is generated: the anchor's target is the root's own file.
    expect(nodes.map((n) => n.filename)).toEqual(['tree'])
    expect(nodes[0]?.schema).toMatchObject({
      properties: { children: { items: { $ref: '#/$defs/tree' } } },
    })
    // Carrying the ref is what makes the generators leave out the self-import.
    expect(nodes[0]?.ref).toBe('#/$defs/tree')
  })

  it('throws when a root $dynamicAnchor cannot round-trip through the root type name', () => {
    const schema = { $dynamicAnchor: 'node', type: 'object', properties: { self: { $dynamicRef: '#node' } } }

    expect(() => collect(schema, 'MyDoc')).toThrow(/does not survive the round trip/)
  })

  it('maps a plain `$ref: "#"` onto the root file too', () => {
    // The ordinary spelling of the same recursive tree. `refToFilename('#')` is
    // not a module and `refToName('#')` is not an identifier, so this used to
    // emit an import of a `ref-<hash>.ts` that was never generated — output that
    // does not compile at all.
    const schema = {
      type: 'object',
      properties: { name: { type: 'string' }, child: { $ref: '#' } },
      required: ['name'],
    }

    const nodes = collect(schema, 'Root')

    expect(nodes.map((n) => n.filename)).toEqual(['root'])
    expect(nodes[0]?.schema).toMatchObject({ properties: { child: { $ref: '#/$defs/root' } } })
    expect(nodes[0]?.ref).toBe('#/$defs/root')
  })

  it('throws when a `$ref: "#"` cannot round-trip through the root type name', () => {
    const schema = { type: 'object', properties: { self: { $ref: '#' } } }

    expect(() => collect(schema, 'MyDoc')).toThrow(/does not survive the round trip/)
  })

  // `$defs: { bool: true }` is a legal definition, but a boolean carries no
  // keywords for a generator to read, so the ref used to resolve to nothing and
  // generation stopped on it. `{}` and `{ not: {} }` say the same thing in a form
  // the ref graph can name.
  it('expands a boolean definition into its object equivalent', () => {
    const schema = {
      type: 'object',
      properties: { yes: { $ref: '#/$defs/yes' }, no: { $ref: '#/$defs/no' } },
      $defs: { yes: true, no: false },
    }

    const nodes = collect(schema, 'Doc')

    expect(nodes.map((n) => n.filename)).toEqual(['doc', 'yes', 'no'])
    expect(nodes[1]?.schema).toEqual({})
    expect(nodes[2]?.schema).toEqual({ not: {} })
  })

  it('leaves boolean subschemas outside a definition map alone', () => {
    // `additionalProperties: true` and `additionalProperties: {}` validate the
    // same but generate different types, so only `$defs` entries are rewritten.
    const schema = { type: 'object', additionalProperties: true, properties: { a: true } }

    expect(collect(schema, 'Doc')[0]?.schema).toEqual(schema)
  })

  // A pointer-form `$dynamicRef` names no `$dynamicAnchor`, so it behaves like a
  // plain `$ref` — and its target has to be generated, or the file that
  // references it imports a module nothing emitted.
  it('generates the target of a pointer-form $dynamicRef', () => {
    const schema = {
      type: 'object',
      properties: { thing: { $dynamicRef: '#/$defs/thing' } },
      $defs: { thing: { type: 'string' } },
    }

    expect(collect(schema, 'Doc').map((n) => n.filename)).toEqual(['doc', 'thing'])
  })

  it('ignores a pointer-form $dynamicRef the document never defines', () => {
    // Nothing downstream emits an import for an unresolvable ref, so queueing it
    // would turn a permissive parser into a build error.
    const schema = { type: 'object', properties: { thing: { $dynamicRef: '#/$defs/missing' } } }

    expect(collect(schema, 'Doc').map((n) => n.filename)).toEqual(['doc'])
  })

  describe('name collisions', () => {
    it('throws when two definitions reduce to the same filename', () => {
      const schema = {
        type: 'object',
        properties: { a: { $ref: '#/$defs/Pet' }, b: { $ref: '#/$defs/pet' } },
        $defs: { Pet: { type: 'object', properties: { legs: { type: 'number' } } }, pet: { type: 'object' } },
      }

      expect(() => collect(schema, 'Doc')).toThrow(/both generate the file "pet\.ts"/)
    })

    // `refToName` folds separators away, so these keep distinct files but land
    // on one type name — and the importer gets two `import { FooBar }` lines.
    it('throws when two definitions reduce to the same type name', () => {
      const schema = {
        type: 'object',
        properties: { a: { $ref: '#/$defs/foo-bar' }, b: { $ref: '#/$defs/foo.bar' } },
        $defs: { 'foo-bar': { type: 'object' }, 'foo.bar': { type: 'object', properties: { x: {} } } },
      }

      expect(() => collect(schema, 'Doc')).toThrow(/both generate the type name "FooBar"/)
    })

    it('throws when a definition collides with the root type name', () => {
      const schema = {
        type: 'object',
        properties: { c: { $ref: '#/$defs/contact' } },
        $defs: { contact: { type: 'object' } },
      }

      expect(() => collect(schema, 'Contact')).toThrow(/the root type Contact/)
    })

    it('merges two spellings of one definition instead of reporting a collision', () => {
      // `upgradeDraft07Schema` aliases every URI-keyed definition to a short
      // name, so a document legitimately reaches one definition two ways.
      const shared = { type: 'object', properties: { id: { type: 'string' } } }
      const schema = {
        allOf: [{ $ref: 'http://example.com/channel.json' }, { $ref: '#/$defs/channel' }],
        $defs: { 'http://example.com/channel.json': shared, channel: shared },
      }

      const filenames = collect(schema, 'Document').map((n) => n.filename)

      expect(filenames.filter((f) => f === 'channel')).toHaveLength(1)
    })

    it('accepts a document where every definition has its own name', () => {
      const schema = {
        type: 'object',
        properties: { a: { $ref: '#/$defs/cat' }, b: { $ref: '#/$defs/dog' } },
        $defs: { cat: { type: 'object' }, dog: { type: 'object' } },
      }

      expect(collect(schema, 'Doc').map((n) => n.filename)).toEqual(['doc', 'cat', 'dog'])
    })

    it('keeps non-ASCII definitions distinct instead of collapsing them onto "_"', () => {
      const schema = {
        type: 'object',
        properties: { a: { $ref: '#/$defs/中文' }, b: { $ref: '#/$defs/日本' } },
        $defs: { 中文: { type: 'object' }, 日本: { type: 'object' } },
      }

      expect(collect(schema, 'Doc').map((n) => n.typeName)).toEqual(['Doc', '中文', '日本'])
    })

    it('resolves a plain $anchor ref to a loadable filename', () => {
      const schema = {
        type: 'object',
        properties: { a: { $ref: '#named' } },
        $defs: { thing: { $anchor: 'named', type: 'object' } },
      }

      const nodes = collect(schema, 'Doc')

      expect(nodes.map((n) => ({ filename: n.filename, typeName: n.typeName }))).toEqual([
        { filename: 'doc', typeName: 'Doc' },
        { filename: 'named', typeName: 'Named' },
      ])
    })
  })

  // `$id` is applied as a base URI before the walk, so a ref written in any of
  // 2020-12's forms becomes an ordinary, nameable definition.
  it('walks a ref that only resolves by applying $id as a base URI', () => {
    const schema = {
      $id: 'http://localhost:1234/tree',
      type: 'object',
      properties: { nodes: { type: 'array', items: { $ref: 'node' } } },
      $defs: { node: { $id: 'http://localhost:1234/node', type: 'object', properties: { v: { type: 'number' } } } },
    }

    const nodes = collect(schema, 'Doc')

    expect(nodes.map((n) => ({ ref: n.ref, filename: n.filename }))).toEqual([
      { ref: undefined, filename: 'doc' },
      { ref: '#/$defs/node', filename: 'node' },
    ])
  })

  // The dangerous half of `$id` scoping: the inner `t` is what the author wrote,
  // and the walker used to generate against the outer one without saying so.
  it('generates the definition the $id scope selects, not the document root’s', () => {
    const schema = {
      type: 'object',
      properties: { inner: { $ref: '#/$defs/inner' } },
      $defs: {
        t: { type: 'string' },
        inner: {
          $id: 'https://example.com/inner',
          $defs: { t: { type: 'number' } },
          type: 'object',
          properties: { value: { $ref: '#/$defs/t' } },
        },
      },
    }

    const nodes = collect(schema, 'Doc')

    expect(nodes.map((n) => n.ref)).toEqual([undefined, '#/$defs/inner', '#/$defs/inner/$defs/t'])
    expect(nodes[2]?.schema).toEqual({ type: 'number' })
  })

  describe('registered documents', () => {
    /** Walks with a registry, collecting the filenames the walk produced. */
    const filenames = (rootSchema: Parameters<typeof walkRefGraph>[0], schemas: Record<string, unknown>): string[] => {
      const names: string[] = []
      walkRefGraph(rootSchema, 'Doc', { schemas }, (node) => names.push(node.filename))
      return names
    }

    it('gives a registered document a file of its own', () => {
      expect(
        filenames({ $ref: 'https://example.com/user.json' }, { 'https://example.com/user.json': { type: 'object' } }),
      ).toEqual(['doc', 'user'])
    })

    it('follows an anchor into a registered document', () => {
      const names = filenames(
        { $ref: 'https://example.com/a.json#thing' },
        { 'https://example.com/a.json': { $defs: { t: { $anchor: 'thing', type: 'string' } } } },
      )

      expect(names).toEqual(['doc', 't'])
    })

    // Reachability is what decides this, not registration: a caller may register
    // everything they happen to have loaded.
    it('skips a registered document nothing references', () => {
      expect(filenames({ type: 'string' }, { 'https://example.com/unused.json': { type: 'object' } })).toEqual(['doc'])
    })

    it('refuses a ref to a URI nobody registered', () => {
      expect(() =>
        filenames({ $ref: 'https://example.com/missing.json' }, { 'https://example.com/other.json': {} }),
      ).toThrow(/Could not resolve \$ref/)
    })

    it('leaves a walk with no registry untouched', () => {
      const schema = { $ref: '#/$defs/a', $defs: { a: { type: 'string' } } }
      const names: string[] = []
      walkRefGraph(schema, 'Doc', {}, (node) => names.push(node.filename))

      expect(names).toEqual(['doc', 'a'])
    })
  })
})
