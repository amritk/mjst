import { describe, expect, it } from 'vitest'

import { loadAsyncApiFixtures } from '../../../fixtures/asyncapi/load-fixtures'
import { buildChannelContract, type ContractDirection } from './build-channel-contract'
import { extractAsyncApi } from './extract-async-api'
import type { ExtractionIssue, NormalizedChannel } from './types'

const channel = (overrides: Partial<NormalizedChannel> = {}): NormalizedChannel => ({
  key: 'lobby',
  messages: [],
  ...overrides,
})

/**
 * The whole document reduced to what a contract says: which channel, which tag,
 * which messages flow which way, and what is left of each payload once the tag
 * is out of it. Full schemas are the extractor's output and are covered there —
 * what these snapshots pin is the *projection*.
 */
const describePayload = (schema: Record<string, unknown>): string => {
  const ref = schema['$ref']
  if (typeof ref === 'string') return `$ref ${ref}`
  const properties = schema['properties']
  if (typeof properties === 'object' && properties !== null) return `properties: ${Object.keys(properties).join(', ')}`
  return `keywords: ${Object.keys(schema).join(', ')}`
}

const describeDirection = (direction: ContractDirection): Record<string, string> =>
  Object.fromEntries(Object.entries(direction).map(([name, schema]) => [name, describePayload(schema)]))

/**
 * Issues grouped reason → the messages it was raised for. Real documents raise
 * one reason across dozens of messages (Slack's RTM renames every wire tag), and
 * forty identical sentences hide the one line that matters.
 */
const describeIssues = (issues: readonly ExtractionIssue[]): Record<string, string> => {
  const grouped = new Map<string, string[]>()
  for (const issue of issues) {
    const names = grouped.get(issue.message) ?? []
    names.push(issue.path.replace(/^.*\/messages\//, ''))
    grouped.set(issue.message, names)
  }
  return Object.fromEntries([...grouped].map(([reason, names]) => [reason, names.join(', ')]))
}

const contractPlan = (fixtureName: string): unknown => {
  const fixture = loadAsyncApiFixtures().find((entry) => entry.name === fixtureName)
  if (!fixture) throw new Error(`missing fixture ${fixtureName}`)
  return extractAsyncApi(fixture.document).channels.map((normalized) => {
    const contract = buildChannelContract(normalized)
    return {
      channel: normalized.key,
      exportName: contract.exportName,
      discriminator: contract.discriminator,
      clientToServer: describeDirection(contract.clientToServer),
      serverToClient: describeDirection(contract.serverToClient),
      issues: describeIssues(contract.issues),
    }
  })
}

describe('build-channel-contract', () => {
  it('maps receive to clientToServer and send to serverToClient', () => {
    const contract = buildChannelContract(
      channel({
        messages: [
          { name: 'say', channelKey: 'lobby', direction: 'receive', payload: { type: 'object' } },
          { name: 'said', channelKey: 'lobby', direction: 'send', payload: { type: 'object' } },
        ],
      }),
    )
    expect(Object.keys(contract.clientToServer)).toEqual(['say'])
    expect(Object.keys(contract.serverToClient)).toEqual(['said'])
    expect(contract.issues).toEqual([])
  })

  it('uses the message name as the wire key and strips the tag from the payload', () => {
    const contract = buildChannelContract(
      channel({
        messages: [
          {
            name: 'hello',
            channelKey: 'lobby',
            direction: 'send',
            payload: { type: 'object', properties: { type: { const: 'hello' }, since: { type: 'number' } } },
          },
        ],
      }),
    )
    expect(contract.serverToClient['hello']).toEqual({ type: 'object', properties: { since: { type: 'number' } } })
  })

  it('records an issue for a message with no direction, and leaves it out', () => {
    const contract = buildChannelContract(
      channel({ messages: [{ name: 'orphan', channelKey: 'lobby', payload: { type: 'object' } }] }),
    )
    expect(contract.clientToServer).toEqual({})
    expect(contract.serverToClient).toEqual({})
    expect(contract.issues[0]?.message).toMatch(/no direction/)
    expect(contract.issues[0]?.path).toBe('#/channels/lobby/messages/orphan')
  })

  // Slack's RTM API names this message `botChanged` and tags the frame
  // `bot_added`. The tag is what arrives, so it is what the contract listens
  // for — keying on the name would wait for a frame that never comes.
  it('keys a message on the wire tag its payload pins, not on its name', () => {
    const contract = buildChannelContract(
      channel({
        messages: [
          {
            name: 'botChanged',
            channelKey: 'lobby',
            direction: 'send',
            payload: { type: 'object', properties: { type: { enum: ['bot_added'] } } },
          },
        ],
      }),
    )
    expect(contract.serverToClient).toEqual({ bot_added: { type: 'object' } })
    expect(contract.issues).toEqual([])
  })

  it('records an issue for a payload that cannot be made contract-legal', () => {
    const contract = buildChannelContract(
      channel({
        messages: [
          {
            name: 'botChanged',
            channelKey: 'lobby',
            direction: 'send',
            payload: { type: 'object', properties: { type: { type: 'string' } } },
          },
        ],
      }),
    )
    expect(contract.serverToClient).toEqual({})
    expect(contract.issues[0]?.message).toMatch(/without pinning it to one value/)
  })

  // A message with no payload has no tag to read, so its name stands in — and
  // 2.x messages inside a `oneOf` are often named positionally, which is the
  // only reason a name reaches a contract key at all.
  it('falls back to the message name when the payload pins nothing', () => {
    const contract = buildChannelContract(
      channel({
        messages: [
          { name: 'lightMeasured', channelKey: 'lobby', direction: 'send', payload: { $ref: '#/$defs/measured' } },
        ],
      }),
    )
    expect(contract.serverToClient).toEqual({ lightMeasured: { $ref: '#/$defs/measured' } })
  })

  // A signal that is the tag and nothing else is a real message. Dropping it
  // would close a legitimate frame as `unknown-type`, which is worse than
  // validating it loosely.
  it('gives a message with no payload an open object schema', () => {
    const contract = buildChannelContract(
      channel({ messages: [{ name: 'goodbye', channelKey: 'lobby', direction: 'send' }] }),
    )
    expect(contract.serverToClient['goodbye']).toEqual({ type: 'object' })
    expect(contract.issues).toEqual([])
  })

  it('skips a message whose payload the extractor could not read', () => {
    const contract = buildChannelContract(
      channel({
        messages: [
          { name: 'reading', channelKey: 'lobby', direction: 'send', schemaFormat: 'application/vnd.apache.avro' },
        ],
      }),
    )
    expect(contract.serverToClient).toEqual({})
    expect(contract.issues[0]?.message).toMatch(/avro/)
  })

  it('keeps the first of two messages that share a wire tag in one direction', () => {
    // 2.x names messages from `name`/`messageId`, which a `oneOf` list may
    // repeat — and one key cannot hold two schemas.
    const contract = buildChannelContract(
      channel({
        messages: [
          { name: 'turnOnOff', channelKey: 'lobby', direction: 'send', payload: { type: 'object', title: 'first' } },
          { name: 'turnOnOff', channelKey: 'lobby', direction: 'send', payload: { type: 'object', title: 'second' } },
        ],
      }),
    )
    expect(contract.serverToClient['turnOnOff']).toEqual({ type: 'object', title: 'first' })
    expect(contract.issues[0]?.message).toMatch(/carry the wire tag "turnOnOff"/)
  })

  it('collides on the tag rather than the name, so differently named messages can clash', () => {
    // Slack declares two messages for its one `bot_added` event. They are
    // distinct in the document and indistinguishable on the wire.
    const payload = (title: string): Record<string, unknown> => ({
      type: 'object',
      title,
      properties: { type: { const: 'bot_added' } },
    })
    const contract = buildChannelContract(
      channel({
        messages: [
          { name: 'botAdded', channelKey: 'lobby', direction: 'send', payload: payload('first') },
          { name: 'botChanged', channelKey: 'lobby', direction: 'send', payload: payload('second') },
        ],
      }),
    )
    expect(contract.serverToClient).toEqual({ bot_added: { type: 'object', title: 'first' } })
    expect(contract.issues[0]?.message).toMatch(/carry the wire tag "bot_added"/)
  })

  // Each direction is its own map, so a request and its reply may share a tag.
  it('lets the two directions use the same wire tag', () => {
    const payload = { type: 'object', properties: { type: { const: 'ping' } } }
    const contract = buildChannelContract(
      channel({
        messages: [
          { name: 'pingOut', channelKey: 'lobby', direction: 'send', payload },
          { name: 'pingIn', channelKey: 'lobby', direction: 'receive', payload },
        ],
      }),
    )
    expect(Object.keys(contract.serverToClient)).toEqual(['ping'])
    expect(Object.keys(contract.clientToServer)).toEqual(['ping'])
    expect(contract.issues).toEqual([])
  })

  // Contract keys come from the document. `target[key] = schema` on a plain
  // object routed this one to the prototype setter: the message disappeared,
  // nothing was recorded, and the returned object's prototype was replaced.
  it('refuses a message named __proto__ instead of losing it', () => {
    const contract = buildChannelContract(
      channel({
        messages: [
          { name: '__proto__', channelKey: 'lobby', direction: 'send', payload: { type: 'object', title: 'evil' } },
          { name: 'hello', channelKey: 'lobby', direction: 'send', payload: { type: 'object' } },
        ],
      }),
    )
    expect(Object.keys(contract.serverToClient)).toEqual(['hello'])
    expect(contract.issues[0]?.message).toMatch(/__proto__/)
    expect(Object.getPrototypeOf(contract.serverToClient)).toBe(Object.prototype)
  })

  // Now that the tag is the key, a payload — not just a name — can carry it.
  it('refuses a payload that pins its tag to __proto__', () => {
    const contract = buildChannelContract(
      channel({
        messages: [
          {
            name: 'evil',
            channelKey: 'lobby',
            direction: 'send',
            payload: { type: 'object', properties: { type: { const: '__proto__' } } },
          },
        ],
      }),
    )
    expect(contract.serverToClient).toEqual({})
    expect(contract.issues[0]?.message).toMatch(/__proto__/)
    expect(Object.getPrototypeOf(contract.serverToClient)).toBe(Object.prototype)
  })

  // Every other reserved-sounding name is an ordinary key, and must survive.
  it('keeps a message named after an Object.prototype member', () => {
    const contract = buildChannelContract(
      channel({
        messages: [
          { name: 'constructor', channelKey: 'lobby', direction: 'send', payload: { type: 'object' } },
          { name: 'toString', channelKey: 'lobby', direction: 'receive', payload: { type: 'object' } },
        ],
      }),
    )
    expect(Object.keys(contract.serverToClient)).toEqual(['constructor'])
    expect(Object.keys(contract.clientToServer)).toEqual(['toString'])
    expect(contract.issues).toEqual([])
  })

  it('honours the channel discriminator over the caller default', () => {
    const contract = buildChannelContract(
      channel({
        discriminator: 'event',
        messages: [
          {
            name: 'ping',
            channelKey: 'lobby',
            direction: 'receive',
            payload: { type: 'object', properties: { event: { const: 'ping' }, type: { type: 'string' } } },
          },
        ],
      }),
      { discriminator: 'kind' },
    )
    expect(contract.discriminator).toBe('event')
    // `type` is an ordinary payload property here, so it stays.
    expect(contract.clientToServer['ping']).toEqual({ type: 'object', properties: { type: { type: 'string' } } })
  })

  it('derives an identifier export name from the channel key', () => {
    expect(buildChannelContract(channel({ key: 'marketDataV1' })).exportName).toBe('marketDataV1Messages')
    expect(buildChannelContract(channel({ key: '/rooms/{roomId}' })).exportName).toBe('roomsRoomIdMessages')
    expect(buildChannelContract(channel({ key: '/' })).exportName).toBe('channelMessages')
    // A key that starts with a digit cannot start an identifier.
    expect(buildChannelContract(channel({ key: '1inchusd' })).exportName).toBe('_1inchusdMessages')
  })

  it('plans the contracts for a 2.6 document', () => {
    expect(contractPlan('v2.6/streetlights-mqtt.yaml')).toMatchInlineSnapshot(`
      [
        {
          "channel": "smartylighting/streetlights/1/0/event/{streetlightId}/lighting/measured",
          "clientToServer": {
            "lightMeasured": "$ref #/$defs/lightMeasuredPayload",
          },
          "discriminator": "type",
          "exportName": "smartylightingStreetlights10EventStreetlightIdLightingMeasuredMessages",
          "issues": {},
          "serverToClient": {},
        },
        {
          "channel": "smartylighting/streetlights/1/0/action/{streetlightId}/turn/on",
          "clientToServer": {},
          "discriminator": "type",
          "exportName": "smartylightingStreetlights10ActionStreetlightIdTurnOnMessages",
          "issues": {},
          "serverToClient": {
            "turnOnOff": "$ref #/$defs/turnOnOffPayload",
          },
        },
        {
          "channel": "smartylighting/streetlights/1/0/action/{streetlightId}/turn/off",
          "clientToServer": {},
          "discriminator": "type",
          "exportName": "smartylightingStreetlights10ActionStreetlightIdTurnOffMessages",
          "issues": {},
          "serverToClient": {
            "turnOnOff": "$ref #/$defs/turnOnOffPayload",
          },
        },
        {
          "channel": "smartylighting/streetlights/1/0/action/{streetlightId}/dim",
          "clientToServer": {},
          "discriminator": "type",
          "exportName": "smartylightingStreetlights10ActionStreetlightIdDimMessages",
          "issues": {},
          "serverToClient": {
            "dimLight": "$ref #/$defs/dimLightPayload",
          },
        },
      ]
    `)
  })

  it('plans the contracts for a 3.0 document', () => {
    expect(contractPlan('v3.0/slack-rtm.yaml')).toMatchInlineSnapshot(`
      [
        {
          "channel": "root",
          "clientToServer": {
            "message": "properties: id, channel, text",
          },
          "discriminator": "type",
          "exportName": "rootMessages",
          "issues": {
            "two serverToClient messages carry the wire tag "bot_added"; keeping the first": "botChanged",
            "two serverToClient messages carry the wire tag "emoji_changed"; keeping the first": "emojiAdded",
          },
          "serverToClient": {
            "accounts_changed": "keywords: type",
            "bot_added": "properties: bot",
            "channel_archive": "properties: channel, user",
            "channel_created": "properties: channel",
            "channel_deleted": "properties: channel",
            "channel_history_changed": "properties: latest, ts, event_ts",
            "channel_joined": "properties: channel",
            "channel_left": "properties: channel",
            "channel_marked": "properties: channel, ts",
            "channel_rename": "properties: channel",
            "channel_unarchive": "properties: channel, user",
            "commands_changed": "properties: event_ts",
            "dnd_updated": "properties: user, dnd_status",
            "dnd_updated_user": "properties: user, dnd_status",
            "email_domain_changed": "properties: email_domain, event_ts",
            "emoji_changed": "properties: subtype, names, event_ts",
            "error": "properties: error",
            "file_change": "properties: file_id, file",
            "file_comment_added": "properties: comment, file_id, file",
            "file_comment_deleted": "properties: comment, file_id, file",
            "file_comment_edited": "properties: comment, file_id, file",
            "file_created": "properties: file_id, file",
            "file_deleted": "properties: file_id, event_ts",
            "file_public": "properties: file_id, file",
            "file_shared": "properties: file_id, file",
            "file_unshared": "properties: file_id, file",
            "goodbye": "keywords: type",
            "group_archive": "properties: channel",
            "group_close": "properties: user, channel",
            "group_history_changed": "properties: latest, ts, event_ts",
            "group_joined": "properties: channel",
            "group_left": "properties: channel",
            "group_marked": "properties: channel, ts",
            "group_open": "properties: user, channel",
            "group_rename": "properties: channel",
            "group_unarchive": "properties: channel, user",
            "hello": "keywords: type",
            "im_close": "properties: channel, user",
            "im_created": "properties: channel, user",
            "im_marked": "properties: channel, ts",
            "im_open": "properties: channel, user",
            "manual_presence_change": "properties: presence",
            "member_joined_channel": "properties: user, channel, channel_type, team, inviter",
            "message": "properties: user, channel, text, ts, attachments, edited",
          },
        },
      ]
    `)
  })
})
