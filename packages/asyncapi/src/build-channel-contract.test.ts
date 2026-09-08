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

  it('records an issue for a payload that cannot be made contract-legal', () => {
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
    expect(contract.serverToClient).toEqual({})
    expect(contract.issues[0]?.message).toMatch(/not pinned to this message's name/)
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

  it('keeps the first of two messages that share a name in one direction', () => {
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
    expect(contract.issues[0]?.message).toMatch(/share the name/)
  })

  // Message names come from the document. `target[name] = schema` on a plain
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
          "clientToServer": {},
          "discriminator": "type",
          "exportName": "rootMessages",
          "issues": {
            "payload's "type" is not pinned to this message's name, so the wire tag and the contract key would disagree": "outgoingMessage, connectionError, accountsChanged, botAdded, botChanged, channelArchive, channelCreated, channelDeleted, channelHistoryChanged, channelJoined, channelLeft, channelMarked, channelRename, channelUnarchive, commandsChanged, dndUpdated, dndUpdatedUser, emailDomainChanged, emojiRemoved, emojiAdded, fileChange, fileCommentAdded, fileCommentDeleted, fileCommentEdited, fileCreated, fileDeleted, filePublic, fileShared, fileUnshared, groupArchive, groupClose, groupHistoryChanged, groupJoined, groupLeft, groupMarked, groupOpen, groupRename, groupUnarchive, imClose, imCreated, imMarked, imOpen, manualPresenceChange, memberJoinedChannel",
          },
          "serverToClient": {
            "goodbye": "keywords: type",
            "hello": "keywords: type",
            "message": "properties: user, channel, text, ts, attachments, edited",
          },
        },
      ]
    `)
  })
})
