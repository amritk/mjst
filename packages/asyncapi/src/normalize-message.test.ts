import { describe, expect, it } from 'vitest'

import { normalizeMessage } from './normalize-message'
import type { ExtractionIssue } from './types'

describe('normalize-message', () => {
  it('normalizes payload and headers independently', () => {
    const issues: ExtractionIssue[] = []
    const message = normalizeMessage(
      {
        name: 'evt',
        channelKey: 'events',
        direction: 'receive',
        contentType: 'application/json',
        payloadSchemaFormat: 'application/vnd.apache.avro;version=1.9.0',
        payload: { type: 'record' },
        headers: { type: 'object', properties: { trace: { type: 'string' } } },
      },
      { asyncapi: '2.6.0' },
      issues,
      '#/channels/events/message',
    )
    // Avro payload skipped, JSON Schema headers kept.
    expect(message.payload).toBeUndefined()
    expect(message.headers?.['properties']).toHaveProperty('trace')
    expect(message.schemaFormat).toContain('avro')
    expect(issues.some((issue) => issue.path.endsWith('/payload'))).toBe(true)
  })

  it('skips a non-object payload with an issue', () => {
    const issues: ExtractionIssue[] = []
    const message = normalizeMessage(
      { name: 'evt', channelKey: 'events', payload: true },
      { asyncapi: '2.6.0' },
      issues,
      '#/x',
    )
    expect(message.payload).toBeUndefined()
    expect(issues[0]?.message).toContain('not an object schema')
  })

  it('leaves a payloadless message issue-free', () => {
    const issues: ExtractionIssue[] = []
    const message = normalizeMessage({ name: 'ping', channelKey: 'events' }, { asyncapi: '2.6.0' }, issues, '#/x')
    expect(message.payload).toBeUndefined()
    expect(message.headers).toBeUndefined()
    expect(issues).toEqual([])
  })

  it('omits optional fields it was not given', () => {
    const issues: ExtractionIssue[] = []
    const message = normalizeMessage(
      { name: 'evt', channelKey: 'events', payload: { type: 'object' } },
      { asyncapi: '2.6.0' },
      issues,
      '#/x',
    )
    expect('direction' in message).toBe(false)
    expect('contentType' in message).toBe(false)
    expect('schemaFormat' in message).toBe(false)
    expect(message.payload).toEqual({ type: 'object' })
  })
})
