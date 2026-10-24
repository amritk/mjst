import { describe, expect, it } from 'vitest'

import { compileQuery, matchPath, query, queryMany, queryManyNodes } from './jsonpath'

const doc = {
  openapi: '3.1.0',
  info: { title: 'API', contact: { name: 'A' } },
  paths: {
    '/users': {
      get: { responses: { '200': { description: 'ok' } } },
      post: { responses: { '201': { description: 'created' } } },
    },
  },
  components: {
    schemas: {
      User: { type: 'object', enum: undefined, properties: { tags: { type: 'array' } } },
      Tag: { type: 'array' },
    },
  },
}

function paths(matches: { path: (string | number)[] }[]): string[] {
  return matches.map((m) => m.path.join('.')).sort()
}

describe('jsonpath engine', () => {
  it('selects the root with $', () => {
    const matches = query(doc, '$')
    expect(matches).toHaveLength(1)
    expect(matches[0]?.value).toBe(doc)
    expect(matches[0]?.path).toEqual([])
  })

  it('resolves child segments', () => {
    const matches = query(doc, '$.info.contact')
    expect(matches).toHaveLength(1)
    expect(matches[0]?.path).toEqual(['info', 'contact'])
    expect(matches[0]?.value).toEqual({ name: 'A' })
  })

  it('normalizes all-digit object keys to numbers (matching legacy behavior)', () => {
    const matches = query(doc, '$.paths[*][*].responses[*]')
    // Path segments for "200"/"201" object keys are normalized to numbers.
    expect(paths(matches)).toEqual(['paths./users.get.responses.200', 'paths./users.post.responses.201'])
  })

  it('expands wildcards over objects and arrays', () => {
    expect(paths(query(doc, '$.paths./users[*]'))).toEqual(['paths./users.get', 'paths./users.post'])
  })

  it('expands method unions', () => {
    const matches = query(doc, '$.paths[*][get,put,post,delete,options,head,patch,trace]')
    expect(paths(matches)).toEqual(['paths./users.get', 'paths./users.post'])
  })

  it('supports recursive descent for a named child', () => {
    const matches = query(doc, '$..description')
    expect(matches.map((m) => m.value).sort()).toEqual(['created', 'ok'])
  })

  it('supports the parent operator ^', () => {
    // Every object that has a `type` key.
    const matches = query(doc, '$..type^')
    const values = matches.map((m) => m.value)
    expect(values).toContainEqual({ type: 'object', enum: undefined, properties: { tags: { type: 'array' } } })
    expect(values).toContainEqual({ type: 'array' })
  })

  it('supports the property-name operator ~', () => {
    const matches = query(doc, '$.paths[*]~')
    expect(matches[0]?.value).toBe('/users')
    expect(matches[0]?.path).toEqual(['paths', '/users'])
  })

  it('supports filter expressions', () => {
    const matches = query(doc, "$..[?(@ && @.type === 'array')]")
    // Both array-typed schemas are selected.
    expect(matches).toHaveLength(2)
    for (const m of matches) expect((m.value as { type: string }).type).toBe('array')
  })

  it('caches compiled paths by expression', () => {
    expect(compileQuery('$.info')).toBe(compileQuery('$.info'))
  })

  it('returns nothing for null/undefined roots', () => {
    expect(query(null, '$.info')).toEqual([])
    expect(query(undefined, '$..x')).toEqual([])
  })

  it('selects negative array indices from the end', () => {
    const data = { list: ['a', 'b', 'c'] }
    expect(query(data, '$.list[-1]')[0]?.value).toBe('c')
    expect(query(data, '$.list[-2]')[0]?.value).toBe('b')
    // A negative index inside a union resolves the same way.
    expect(query(data, '$.list[0,-1]').map((m) => m.value)).toEqual(['a', 'c'])
  })
})

describe('jsonpath queryMany', () => {
  it('evaluates several paths in one pass, index-aligned with the input', () => {
    // A mix of direct and recursive-descent paths returns one match array each.
    const compiled = [
      compileQuery('$.info.title'),
      compileQuery('$..description'),
      compileQuery('$.components.schemas.Tag'),
    ]
    const [titles, descriptions, tag] = queryMany(doc, compiled)
    expect(titles?.map((m) => m.value)).toEqual(['API'])
    expect(descriptions?.map((m) => m.value).sort()).toEqual(['created', 'ok'])
    expect(tag?.[0]?.value).toEqual({ type: 'array' })
  })

  it('returns plain matches with the path already built', () => {
    // `queryMany` is public and sits on top of the lazy `queryManyNodes`; its
    // matches must still be plain `{ value, path }` data with a normalized path.
    const [responses] = queryMany(doc, [compileQuery('$..responses.*')])
    expect(responses).toStrictEqual([
      { value: { description: 'ok' }, path: ['paths', '/users', 'get', 'responses', 200] },
      { value: { description: 'created' }, path: ['paths', '/users', 'post', 'responses', 201] },
    ])
    // `toStrictEqual` passes for a getter too; the path has to be a plain data property.
    expect(Object.getOwnPropertyDescriptor(responses?.[0], 'path')?.value).toEqual(responses?.[0]?.path)
  })

  it('builds the same normalized paths from queryManyNodes on demand', () => {
    const compiled = [
      compileQuery('$.info.title'),
      compileQuery('$..description'),
      compileQuery('$.paths.*..responses[*]'),
      compileQuery('info.title'),
    ]
    const options = [undefined, { schemaAware: true }, undefined, undefined]
    const paths = queryManyNodes(doc, compiled, options).map((nodes) => nodes.map(matchPath))
    expect(paths).toStrictEqual([
      [['info', 'title']],
      [
        ['paths', '/users', 'get', 'responses', 200, 'description'],
        ['paths', '/users', 'post', 'responses', 201, 'description'],
      ],
      [
        ['paths', '/users', 'get', 'responses', 200],
        ['paths', '/users', 'post', 'responses', 201],
      ],
      [],
    ])
    expect(paths).toStrictEqual(queryMany(doc, compiled, options).map((matches) => matches.map((m) => m.path)))
  })

  it('enters a shared object once per key when skipping revisits', () => {
    // What `$ref` resolution produces: one object wherever a reference pointed at it.
    const shared = { description: 'x', nested: { description: 'y' } }
    const tree = { a: { s: shared }, b: { s: shared }, c: { t: shared } }
    const compiled = [compileQuery('$..description')]
    const paths = (skipRevisits: boolean) =>
      queryManyNodes(tree, compiled, [], { skipRevisits })[0]?.map((node) => matchPath(node).join('.'))
    expect(paths(false)).toStrictEqual([
      'a.s.description',
      'a.s.nested.description',
      'b.s.description',
      'b.s.nested.description',
      'c.t.description',
      'c.t.nested.description',
    ])
    // `b.s` repeats `a.s` exactly. `c.t` enters under another key, which its own children's
    // matches could read, so it is walked again — but `nested` enters under the key it had the
    // first time, so nothing below it is.
    expect(paths(true)).toStrictEqual(['a.s.description', 'a.s.nested.description', 'c.t.description'])
  })

  it('keeps every route for a query that can see it', () => {
    const shared = { leaf: { description: 'x' } }
    const tree = { a: { s: shared }, b: { s: shared } }
    // `@path` spells out the route — in the descent or in a step after it — and
    // `^^` climbs from the seed past the shared object.
    for (const expression of ['$..[?(@path && @.description)]', '$..leaf[?(@path && @)]', '$..description^^']) {
      const [nodes] = queryManyNodes(tree, [compileQuery(expression)], [], { skipRevisits: true })
      expect(nodes?.map((node) => matchPath(node)[0])).toStrictEqual(['a', 'b'])
    }
  })

  it('keeps skipping revisits for the queries that cannot see the route when one can', () => {
    const shared = { leaf: { description: 'x' } }
    const tree = { a: { s: shared }, b: { s: shared } }
    const compiled = [compileQuery('$..description'), compileQuery('$..[?(@path && @.description)]')]
    const [plain, routed] = queryManyNodes(tree, compiled, [], { skipRevisits: true })
    expect(plain?.map((node) => matchPath(node)[0])).toStrictEqual(['a'])
    expect(routed?.map((node) => matchPath(node)[0])).toStrictEqual(['a', 'b'])
  })

  it('skips revisits for a query that steps on from its descent without seeing the route', () => {
    const shared = { leaf: { description: 'x' } }
    const tree = { a: { s: shared }, b: { s: shared } }
    const [nodes] = queryManyNodes(tree, [compileQuery('$..leaf.description')], [], { skipRevisits: true })
    expect(nodes?.map((node) => matchPath(node).join('.'))).toStrictEqual(['a.s.leaf.description'])
  })

  it('tells an entry into a name map from one into a schema when skipping revisits', () => {
    // `x` is entered under the key `properties` both times, but only the second time
    // is it a map of names, where `enum` is a property rather than instance data.
    const x = { enum: { description: 'x' } }
    const tree = { properties: { properties: x }, a: { properties: x } }
    const [nodes] = queryManyNodes(tree, [compileQuery('$..description')], [{ schemaAware: true }], {
      skipRevisits: true,
    })
    expect(nodes?.map((node) => matchPath(node).join('.'))).toStrictEqual(['a.properties.enum.description'])
  })

  it('walks a shared object again when it is entered in another walk state', () => {
    // Under `a` both queries are live; under `b` only the second is. A matching
    // key is not enough to skip: the state the walk enters in decides what can match.
    const shared = { description: 'x' }
    const tree = { a: { s: shared }, b: { s: shared } }
    const compiled = [compileQuery('$.a..description'), compileQuery('$..description')]
    const [underA, everywhere] = queryManyNodes(tree, compiled, [], { skipRevisits: true })
    expect(underA?.map((node) => matchPath(node).join('.'))).toStrictEqual(['a.s.description'])
    expect(everywhere?.map((node) => matchPath(node).join('.'))).toStrictEqual(['a.s.description', 'b.s.description'])
  })

  it('walks layered shared objects in linear time when skipping revisits', () => {
    // Each layer reaches the next by two keys, so a tree walk has 2^30 routes to the leaf.
    let layer: Record<string, unknown> = { description: 'leaf' }
    for (let i = 0; i < 30; i++) layer = { left: layer, right: layer }
    const [nodes] = queryManyNodes({ root: layer }, [compileQuery('$..description')], [], { skipRevisits: true })
    // The leaf is reached under both keys, so it matches once for each — not once per route.
    expect(nodes?.map((node) => matchPath(node).length)).toStrictEqual([32, 32])
  })

  it('returns empty arrays for a null root, one per path', () => {
    const out = queryMany(null, [compileQuery('$.a'), compileQuery('$..b')])
    expect(out).toEqual([[], []])
  })

  it('yields no matches for a malformed path while others still resolve', () => {
    const out = queryMany(doc, [compileQuery('info.title'), compileQuery('$.info.title')])
    expect(out[0]).toEqual([])
    expect(out[1]?.map((m) => m.value)).toEqual(['API'])
  })

  it('agrees with `query` about a non-enumerable own property: neither sees it', () => {
    // The shared descent seeds from `Object.keys`, so it can only ever find
    // enumerable keys. A per-path own-property check would have found this one,
    // making the same expression answer differently depending on whether it was
    // batched — and reporting a node that `$..*` and every filter walk skip.
    const hidden = { kind: 'secret' }
    const node: Record<string, unknown> = { visible: 1 }
    Object.defineProperty(node, 'hidden', { value: hidden, enumerable: false })
    const root = { wrap: node }

    for (const expression of ['$..hidden', '$.wrap.hidden', "$.wrap['hidden']", '$.wrap[?(@.kind)]']) {
      const direct = query(root, expression)
      const batched = queryMany(root, [compileQuery(expression)])[0]
      expect(direct, expression).toEqual([])
      expect(batched, expression).toEqual(direct)
    }

    // A filter reading the same member answers the same way, so a node cannot be
    // selected by a property the engine will not then let anyone address.
    expect(query(root, '$..[?(@.hidden)]')).toEqual([])
    expect(query(root, '$..[?(@.visible)]').map((m) => m.value)).toEqual([node])

    // The enumerable sibling is unaffected, batched or not.
    expect(query(root, '$..visible').map((m) => m.value)).toEqual([1])
    expect(queryMany(root, [compileQuery('$..visible')])[0]?.map((m) => m.value)).toEqual([1])
  })

  it('keeps a schema-aware descent out of example and default data', () => {
    const schemas = {
      Pet: {
        type: 'object',
        properties: {
          // Property names that happen to be data keywords are still schemas.
          default: { type: 'object' },
          enum: { type: 'object' },
        },
        examples: [{ nested: { type: 'object' } }],
        default: { type: 'object' },
      },
    }
    const expression = "$.schemas..[?(@ && @.type === 'object')]"
    const document = { schemas }
    const paths = (options?: { schemaAware: boolean }) =>
      query(document, expression, options).map((match) => match.path.join('/'))

    // A filter step yields a node's matching children when it visits the node,
    // so `Pet/default` comes out before anything under `properties`.
    expect(paths()).toEqual([
      'schemas/Pet',
      'schemas/Pet/default',
      'schemas/Pet/properties/default',
      'schemas/Pet/properties/enum',
      'schemas/Pet/examples/0/nested',
    ])
    expect(paths({ schemaAware: true })).toEqual([
      'schemas/Pet',
      'schemas/Pet/properties/default',
      'schemas/Pet/properties/enum',
    ])
    expect(queryMany(document, [compileQuery(expression)], [{ schemaAware: true }])[0]).toEqual(
      query(document, expression, { schemaAware: true }),
    )
  })

  it('goes into named components called default under the AsyncAPI and OpenAPI maps', () => {
    const payload = { type: 'object' }
    const document = {
      components: { messageTraits: { default: { payload } } },
      webhooks: { default: { post: { requestBody: { content: { 'application/json': { schema: payload } } } } } },
    }
    const expression = "$..[?(@ && @.type === 'object')]"
    expect(query(document, expression, { schemaAware: true }).map((match) => match.path.join('/'))).toEqual([
      'components/messageTraits/default/payload',
      'webhooks/default/post/requestBody/content/application/json/schema',
    ])
    expect(queryMany(document, [compileQuery(expression)], [{ schemaAware: true }])[0]).toEqual(
      query(document, expression, { schemaAware: true }),
    )
  })

  it.each([
    'webhooks',
    'encoding',
    'variables',
    'dependencies',
    'servers',
    'serverVariables',
    'messageTraits',
    'operationTraits',
    'correlationIds',
    'replies',
    'replyAddresses',
    'serverBindings',
    'channelBindings',
    'operationBindings',
    'messageBindings',
  ])('treats the keys of %s as names in a schema-aware descent', (map) => {
    const document = { [map]: { default: { type: 'object' } } }
    expect(query(document, '$..type', { schemaAware: true }).map((match) => match.path.join('/'))).toEqual([
      `${map}/default/type`,
    ])
    expect(queryMany(document, [compileQuery('$..type')], [{ schemaAware: true }])[0]).toEqual(
      query(document, '$..type', { schemaAware: true }),
    )
  })
})
