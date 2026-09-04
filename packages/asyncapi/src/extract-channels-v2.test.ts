import { describe, expect, it } from 'vitest'

import { extractChannelsV2 } from './extract-channels-v2'
import type { ExtractionIssue } from './types'

describe('extract-channels-v2', () => {
  it('names oneOf alternatives by name, messageId, then position', () => {
    const issues: ExtractionIssue[] = []
    const channels = extractChannelsV2(
      {
        asyncapi: '2.6.0',
        channels: {
          events: {
            publish: {
              message: {
                oneOf: [
                  { name: 'named', payload: { type: 'object' } },
                  { messageId: 'byId', payload: { type: 'object' } },
                  { payload: { type: 'object' } },
                ],
              },
            },
          },
        },
      },
      issues,
    )
    expect(channels[0]?.messages.map((message) => message.name)).toEqual(['named', 'byId', 'message-3'])
    expect(issues).toEqual([])
  })

  it('dereferences message and trait refs through components', () => {
    const issues: ExtractionIssue[] = []
    const channels = extractChannelsV2(
      {
        asyncapi: '2.6.0',
        channels: { events: { subscribe: { message: { $ref: '#/components/messages/evt' } } } },
        components: {
          messages: {
            evt: {
              name: 'evt',
              traits: [{ $ref: '#/components/messageTraits/common' }],
              payload: { type: 'object' },
            },
          },
          messageTraits: { common: { contentType: 'application/xml' } },
        },
      },
      issues,
    )
    const message = channels[0]?.messages[0]
    expect(message?.name).toBe('evt')
    expect(message?.direction).toBe('send')
    expect(message?.contentType).toBe('application/xml')
    expect(issues).toEqual([])
  })

  it('falls back to the document defaultContentType', () => {
    const channels = extractChannelsV2(
      {
        asyncapi: '2.6.0',
        defaultContentType: 'application/json',
        channels: { events: { publish: { message: { name: 'evt', payload: { type: 'object' } } } } },
      },
      [],
    )
    expect(channels[0]?.messages[0]?.contentType).toBe('application/json')
  })

  it('uses the channel key as the address', () => {
    const channels = extractChannelsV2({ asyncapi: '2.6.0', channels: { 'user/{id}/events': {} } }, [])
    expect(channels[0]?.key).toBe('user/{id}/events')
    expect(channels[0]?.address).toBe('user/{id}/events')
  })

  it("lets a trait override the message's own keys, per 2.x merge-patch semantics", () => {
    const issues: ExtractionIssue[] = []
    const channels = extractChannelsV2(
      {
        asyncapi: '2.6.0',
        channels: {
          events: {
            publish: {
              message: {
                name: 'evt',
                contentType: 'application/json',
                traits: [{ schemaFormat: 'application/vnd.apache.avro;version=1.9.0', contentType: 'application/xml' }],
                payload: { type: 'record' },
              },
            },
          },
        },
      },
      issues,
    )
    const message = channels[0]?.messages[0]
    // The trait's Avro format wins over nothing-declared AND over any inline
    // declaration, so the payload is gated out rather than emitted as JSON Schema.
    expect(message?.contentType).toBe('application/xml')
    expect(message?.schemaFormat).toContain('avro')
    expect(message?.payload).toBeUndefined()
    expect(issues.length).toBeGreaterThan(0)
  })

  it('accepts an operation without a message, which 2.x allows', () => {
    const issues: ExtractionIssue[] = []
    const channels = extractChannelsV2(
      { asyncapi: '2.6.0', channels: { events: { publish: { operationId: 'onEvents', bindings: {} } } } },
      issues,
    )
    expect(channels[0]?.messages).toEqual([])
    expect(issues).toEqual([])
  })

  it('skips a dangling message ref with an issue and keeps the channel', () => {
    const issues: ExtractionIssue[] = []
    const channels = extractChannelsV2(
      { asyncapi: '2.6.0', channels: { events: { publish: { message: { $ref: '#/components/messages/ghost' } } } } },
      issues,
    )
    expect(channels[0]?.messages).toEqual([])
    expect(issues.length).toBe(1)
  })
})
