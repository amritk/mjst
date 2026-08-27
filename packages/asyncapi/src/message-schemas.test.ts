import { describe, expect, it } from 'vitest'

import { listMessageSchemas } from './message-schemas'
import type { AsyncApiModel, ExtractionIssue, NormalizedMessage } from './types'

const message = (name: string, overrides: Partial<NormalizedMessage> = {}): NormalizedMessage => ({
  name,
  channelKey: 'events',
  payload: { type: 'object' },
  ...overrides,
})

const model = (channels: AsyncApiModel['channels'], issues: ExtractionIssue[] = []): AsyncApiModel => ({
  version: '3.0.0',
  major: 3,
  channels,
  issues,
})

describe('message-schemas', () => {
  it('lays each message out under channels/<channel>/<message>', () => {
    const schemas = listMessageSchemas(
      model([
        {
          key: 'user/{id}/events',
          messages: [message('userCreated'), message('ping', { payload: undefined })],
        },
      ]),
    )
    expect(schemas).toEqual([
      {
        subDir: 'channels/user-id-events/user-created',
        rootTypeName: 'UserCreated',
        schema: { type: 'object' },
      },
    ])
  })

  it('emits a sibling -headers tree with a Headers-suffixed root type', () => {
    const schemas = listMessageSchemas(
      model([
        {
          key: 'events',
          messages: [message('evt', { headers: { type: 'object', properties: {} } })],
        },
      ]),
    )
    expect(schemas.map((schema) => schema.subDir)).toEqual(['channels/events/evt', 'channels/events/evt-headers'])
    expect(schemas[1]?.rootTypeName).toBe('EvtHeaders')
  })

  it('suffixes colliding tokens deterministically with an issue', () => {
    const issues: ExtractionIssue[] = []
    const schemas = listMessageSchemas(
      model(
        [
          { key: 'user/events', messages: [message('a')] },
          { key: 'user-events', messages: [message('a')] },
        ],
        issues,
      ),
    )
    expect(schemas.map((schema) => schema.subDir)).toEqual(['channels/user-events/a', 'channels/user-events-2/a'])
    expect(issues.some((issue) => issue.message.includes('user-events'))).toBe(true)
  })

  it('suffixes messages whose names sanitize identically within a channel', () => {
    const schemas = listMessageSchemas(model([{ key: 'events', messages: [message('myEvent'), message('my event')] }]))
    expect(schemas.map((schema) => schema.subDir)).toEqual(['channels/events/my-event', 'channels/events/my-event-2'])
  })

  it('keeps a message named like a sibling headers tree out of that directory', () => {
    const issues: ExtractionIssue[] = []
    const schemas = listMessageSchemas(
      model(
        [
          {
            key: 'events',
            messages: [message('light', { headers: { type: 'object' } }), message('light-headers')],
          },
        ],
        issues,
      ),
    )
    // The derived light-headers directory is reserved when `light` is
    // claimed, so the literal message moves aside instead of sharing it.
    expect(schemas.map((schema) => schema.subDir)).toEqual([
      'channels/events/light',
      'channels/events/light-headers',
      'channels/events/light-headers-2',
    ])
    expect(new Set(schemas.map((schema) => schema.subDir)).size).toBe(schemas.length)
    expect(issues.length).toBeGreaterThan(0)
  })

  it('falls back to stable tokens for names that sanitize away', () => {
    const schemas = listMessageSchemas(model([{ key: '///', messages: [message('{}')] }]))
    expect(schemas[0]?.subDir).toBe('channels/channel/message')
    expect(schemas[0]?.rootTypeName).toBe('Message')
  })
})
