import { describe, expect, it } from 'vitest'

import { extractChannelsV3 } from './extract-channels-v3'
import type { ExtractionIssue } from './types'

const baseDocument = {
  asyncapi: '3.0.0',
  channels: {
    events: {
      address: 'user/{id}/events',
      messages: {
        created: { payload: { type: 'object', properties: { id: { type: 'string' } } } },
        deleted: { payload: { type: 'object' } },
      },
    },
  },
}

describe('extract-channels-v3', () => {
  it('reads the channel address and message map keys', () => {
    const channels = extractChannelsV3({ ...baseDocument }, [])
    expect(channels[0]?.key).toBe('events')
    expect(channels[0]?.address).toBe('user/{id}/events')
    expect(channels[0]?.messages.map((message) => message.name).sort()).toEqual(['created', 'deleted'])
  })

  it('scopes an operation with a messages list to just those messages', () => {
    const channels = extractChannelsV3(
      {
        ...baseDocument,
        operations: {
          onCreated: {
            action: 'receive',
            channel: { $ref: '#/channels/events' },
            messages: [{ $ref: '#/channels/events/messages/created' }],
          },
        },
      },
      [],
    )
    const byName = new Map(channels[0]?.messages.map((message) => [message.name, message]))
    expect(byName.get('created')?.direction).toBe('receive')
    expect(byName.get('deleted')?.direction).toBeUndefined()
  })

  it('covers the whole channel when an operation lists no messages', () => {
    const channels = extractChannelsV3(
      { ...baseDocument, operations: { onAny: { action: 'send', channel: { $ref: '#/channels/events' } } } },
      [],
    )
    for (const message of channels[0]?.messages ?? []) {
      expect(message.direction).toBe('send')
    }
  })

  it('keeps the first direction and reports a conflict', () => {
    const issues: ExtractionIssue[] = []
    const channels = extractChannelsV3(
      {
        ...baseDocument,
        operations: {
          a: {
            action: 'receive',
            channel: { $ref: '#/channels/events' },
            messages: [{ $ref: '#/channels/events/messages/created' }],
          },
          b: {
            action: 'send',
            channel: { $ref: '#/channels/events' },
            messages: [{ $ref: '#/channels/events/messages/created' }],
          },
        },
      },
      issues,
    )
    expect(channels[0]?.messages.find((message) => message.name === 'created')?.direction).toBe('receive')
    expect(issues.some((issue) => issue.message.includes('both sent and received'))).toBe(true)
  })

  it('matches an inlined operation channel by identity', () => {
    // A resolver that inlined the refs replaces `$ref` nodes with the shared
    // channel object, so pointer matching has nothing to read.
    const sharedChannel = {
      address: 'topic',
      messages: { evt: { payload: { type: 'object' } } },
    }
    const channels = extractChannelsV3(
      {
        asyncapi: '3.0.0',
        channels: { topic: sharedChannel },
        operations: { onEvt: { action: 'receive', channel: sharedChannel } },
      },
      [],
    )
    expect(channels[0]?.messages[0]?.direction).toBe('receive')
  })

  it('unwraps multi format payloads and headers', () => {
    const issues: ExtractionIssue[] = []
    const channels = extractChannelsV3(
      {
        asyncapi: '3.0.0',
        channels: {
          events: {
            messages: {
              avro: {
                payload: { schemaFormat: 'application/vnd.apache.avro;version=1.9.0', schema: { type: 'record' } },
                headers: {
                  schemaFormat: 'application/schema+json;version=draft-07',
                  schema: { type: 'object', definitions: { t: { type: 'string' } } },
                },
              },
            },
          },
        },
      },
      issues,
    )
    const message = channels[0]?.messages[0]
    expect(message?.payload).toBeUndefined()
    expect(message?.schemaFormat).toContain('avro')
    // Headers carried their own draft-07 declaration; the upgrade renamed definitions.
    expect(message?.headers?.['$defs']).toEqual({ t: { type: 'string' } })
    expect(issues.some((issue) => issue.message.includes('avro'))).toBe(true)
  })

  it('resolves channel and message refs through components', () => {
    const channels = extractChannelsV3(
      {
        asyncapi: '3.0.0',
        channels: { events: { $ref: '#/components/channels/events' } },
        components: {
          channels: { events: { address: 'topic', messages: { evt: { $ref: '#/components/messages/evt' } } } },
          messages: { evt: { payload: { type: 'object' } } },
        },
      },
      [],
    )
    expect(channels[0]?.address).toBe('topic')
    expect(channels[0]?.messages[0]?.name).toBe('evt')
    expect(channels[0]?.messages[0]?.payload).toEqual({ type: 'object' })
  })
})
