import { describe, expect, it, vi } from 'vitest'

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

  it('warns and skips a ref that cannot be resolved', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const schema = { properties: { missing: { $ref: '#/$defs/nope' } }, $defs: {} }

    const nodes = collect(schema, 'Document')

    expect(nodes.map((n) => n.filename)).toEqual(['document'])
    expect(warn).toHaveBeenCalledWith('Warning: Could not resolve ref: #/$defs/nope')
    warn.mockRestore()
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
    // root keeps its own (merged) schema even when the filename collides.
    const schema = {
      title: 'Expr',
      $ref: '#/$defs/expr',
      type: 'object',
      properties: { extra: { type: 'string' } },
      $defs: { expr: { type: 'object', properties: { kind: { type: 'string' } } } },
    }

    const nodes = collect(schema, 'Expr')

    expect(nodes[0]?.ref).toBeUndefined()
    expect(nodes[0]?.schema).toHaveProperty('properties')
  })
})
