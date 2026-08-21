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

  it('leaves the envelope open, as the SSE grammar does', () => {
    expect(sseItemSchema({ type: 'string' })).not.toHaveProperty('additionalProperties')
  })
})
