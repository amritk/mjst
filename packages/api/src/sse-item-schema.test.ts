import { describe, expect, it } from 'vitest'

import { sseItemSchema } from './sse-item-schema'

describe('sseItemSchema', () => {
  it('wraps a payload schema in the SSE event envelope', () => {
    expect(sseItemSchema({ type: 'object', properties: { token: { type: 'string' } } })).toEqual({
      type: 'object',
      properties: {
        event: { type: 'string' },
        data: { type: 'object', properties: { token: { type: 'string' } } },
        retry: { type: 'integer' },
      },
    })
  })

  it('pins the event name as a const and requires it', () => {
    const item = sseItemSchema({ type: 'string' }, { event: 'token' })
    expect(item['properties']).toMatchObject({ event: { type: 'string', const: 'token' } })
    expect(item['required']).toEqual(['event'])
  })

  it('adds id only for a resumable stream', () => {
    expect(sseItemSchema({ type: 'string' })['properties']).not.toHaveProperty('id')
    expect(sseItemSchema({ type: 'string' }, { id: true })['properties']).toMatchObject({ id: { type: 'string' } })
  })

  it('never requires data — a keep-alive frame carries none', () => {
    // `required` is omitted entirely rather than emitted empty: an empty
    // `required` array is legal JSON Schema but says nothing.
    expect(sseItemSchema({ type: 'string' })).not.toHaveProperty('required')
    expect(sseItemSchema({ type: 'string' }, { event: 'token' })['required']).not.toContain('data')
  })

  it("lifts a payload schema's $defs to the envelope root", () => {
    // `#/$defs/Node` resolves against the document root, so nesting a
    // self-contained schema under `properties.data` would leave every internal
    // ref dangling — and `toOpenApi`'s hoisting re-roots them at the component,
    // which is still not where they would live.
    const payload = {
      type: 'object',
      properties: { node: { $ref: '#/$defs/Node' } },
      $defs: { Node: { type: 'object', properties: { id: { type: 'string' } } } },
    }
    const item = sseItemSchema(payload)
    expect(item['$defs']).toEqual(payload.$defs)
    const data = (item['properties'] as Record<string, unknown>)['data'] as Record<string, unknown>
    expect(data['$defs']).toBeUndefined()
    expect(data['properties']).toEqual({ node: { $ref: '#/$defs/Node' } })
  })

  it('leaves a payload without $defs untouched', () => {
    const payload = { type: 'object', properties: { a: { type: 'string' } } }
    const item = sseItemSchema(payload)
    expect(item).not.toHaveProperty('$defs')
    expect((item['properties'] as Record<string, unknown>)['data']).toBe(payload)
  })

  it('re-aims a recursive self-reference at the payload, not the envelope', () => {
    // `$ref: '#'` meant "this payload" before the nesting. Left alone it now
    // resolves to the SSE envelope, so a tree of nodes would describe itself as
    // a stream of `{ event, data, retry }`.
    const item = sseItemSchema({
      type: 'object',
      properties: { child: { $ref: '#' } },
    })
    const data = (item['properties'] as Record<string, unknown>)['data'] as Record<string, unknown>
    expect((data['properties'] as Record<string, Record<string, unknown>>)['child']).toEqual({
      $ref: '#/properties/data',
    })
  })

  it('prefixes any other local pointer, and leaves external refs alone', () => {
    const item = sseItemSchema({
      type: 'object',
      properties: {
        self: { $ref: '#/properties/name' },
        away: { $ref: 'https://example.com/schema.json#/$defs/X' },
        name: { type: 'string' },
      },
    })
    const props = ((item['properties'] as Record<string, unknown>)['data'] as Record<string, unknown>)[
      'properties'
    ] as Record<string, Record<string, unknown>>
    expect(props['self']).toEqual({ $ref: '#/properties/data/properties/name' })
    expect(props['away']).toEqual({ $ref: 'https://example.com/schema.json#/$defs/X' })
  })

  it('re-aims refs inside the lifted $defs too', () => {
    const item = sseItemSchema({
      type: 'object',
      $defs: { Node: { type: 'object', properties: { parent: { $ref: '#' }, kin: { $ref: '#/$defs/Node' } } } },
      properties: { root: { $ref: '#/$defs/Node' } },
    })
    const defs = (item['$defs'] as Record<string, Record<string, unknown>>)['Node']
    const props = defs?.['properties'] as Record<string, Record<string, unknown>>
    // `#` still meant the payload; `#/$defs/…` was lifted and stays verbatim.
    expect(props['parent']).toEqual({ $ref: '#/properties/data' })
    expect(props['kin']).toEqual({ $ref: '#/$defs/Node' })
  })

  it('leaves the envelope open, as the SSE grammar does', () => {
    expect(sseItemSchema({ type: 'string' })).not.toHaveProperty('additionalProperties')
  })
})
