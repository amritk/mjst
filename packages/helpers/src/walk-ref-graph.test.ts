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
})
