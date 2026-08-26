import { validate } from '@amritk/runtime-validators'
import { describe, expect, it } from 'vitest'

import { loadAsyncApiFixtures } from '../../../fixtures/asyncapi/load-fixtures'
import { extractAsyncApi } from './extract-async-api'
import { listMessageSchemas } from './message-schemas'

const fixtures = loadAsyncApiFixtures()

const fixtureNamed = (name: string) => {
  const fixture = fixtures.find((candidate) => candidate.name === name)
  if (!fixture) throw new Error(`fixture ${name} is missing`)
  return fixture
}

const messageOn = (channels: ReturnType<typeof extractAsyncApi>['channels'], channelKey: string, name: string) => {
  const message = channels.find((c) => c.key === channelKey)?.messages.find((m) => m.name === name)
  if (!message) throw new Error(`message ${name} on channel ${channelKey} is missing`)
  return message
}

describe('extract-async-api', () => {
  it('rejects a document with no asyncapi version', () => {
    expect(() => extractAsyncApi({ openapi: '3.1.0' })).toThrow(/Not an AsyncAPI document/)
    expect(() => extractAsyncApi(null)).toThrow(/Not an AsyncAPI document/)
    expect(() => extractAsyncApi({ asyncapi: '4.0.0' })).toThrow(/Not an AsyncAPI document/)
  })

  // Robustness: every vendored real-world document must extract without
  // throwing, and every schema it yields must build a runnable validator —
  // guarding against a payload shape the normalizer mangles into something
  // the interpreter refuses.
  for (const fixture of fixtures) {
    it(`extracts ${fixture.name} and every schema builds a validator`, () => {
      const model = extractAsyncApi(fixture.document)
      expect(model.channels.length).toBeGreaterThan(0)
      const schemas = listMessageSchemas(model)
      expect(schemas.length).toBeGreaterThan(0)
      for (const extracted of schemas) {
        expect(() => validate(extracted.schema)).not.toThrow()
      }
    })
  }

  it('maps 2.x publish/subscribe onto application-relative directions', () => {
    const model = extractAsyncApi(fixtureNamed('v2.6/streetlights-mqtt.yaml').document)
    // The lighting channel is a `publish` operation: clients publish, the app receives.
    const measured = messageOn(
      model.channels,
      'smartylighting/streetlights/1/0/event/{streetlightId}/lighting/measured',
      'lightMeasured',
    )
    expect(measured.direction).toBe('receive')
    const turnOn = messageOn(
      model.channels,
      'smartylighting/streetlights/1/0/action/{streetlightId}/turn/on',
      'turnOnOff',
    )
    expect(turnOn.direction).toBe('send')
  })

  it('reads 3.0 directions off the operations map', () => {
    const model = extractAsyncApi(fixtureNamed('v3.0/streetlights-mqtt.yaml').document)
    expect(messageOn(model.channels, 'lightingMeasured', 'lightMeasured').direction).toBe('receive')
    expect(messageOn(model.channels, 'lightTurnOn', 'turnOn').direction).toBe('send')
  })

  it('rebases component refs so payloads stand alone', () => {
    const model = extractAsyncApi(fixtureNamed('v3.0/streetlights-mqtt.yaml').document)
    const payload = messageOn(model.channels, 'lightingMeasured', 'lightMeasured').payload
    expect(payload).toBeDefined()
    // The payload was a $ref into #/components/schemas; it must now point at a
    // local $defs entry, and no pointer into the source document may survive.
    expect(JSON.stringify(payload)).not.toContain('#/components/')
    expect(payload?.['$defs']).toHaveProperty('lightMeasuredPayload')
  })

  it('merges message traits, so trait-contributed headers survive', () => {
    const model = extractAsyncApi(fixtureNamed('v2.6/streetlights-mqtt.yaml').document)
    const measured = messageOn(
      model.channels,
      'smartylighting/streetlights/1/0/event/{streetlightId}/lighting/measured',
      'lightMeasured',
    )
    // `headers` comes only from the commonHeaders trait in this document.
    expect(measured.headers?.['properties']).toHaveProperty('my-app-header')
  })

  it('keeps a declared draft-07 schemaFormat generatable', () => {
    const model = extractAsyncApi(fixtureNamed('v2.6/gitter-streaming.yaml').document)
    const withPayloads = model.channels.flatMap((channel) => channel.messages).filter((m) => m.payload !== undefined)
    expect(withPayloads.length).toBeGreaterThan(0)
    for (const message of withPayloads) {
      expect(message.schemaFormat).toContain('draft-07')
    }
  })

  it('skips an Avro payload with an issue and keeps the JSON Schema siblings', () => {
    const document = {
      asyncapi: '2.6.0',
      info: { title: 'Mixed', version: '1.0.0' },
      channels: {
        events: {
          publish: {
            message: {
              oneOf: [
                {
                  name: 'avroEvent',
                  schemaFormat: 'application/vnd.apache.avro;version=1.9.0',
                  payload: { type: 'record', name: 'Event', fields: [] },
                },
                { name: 'jsonEvent', payload: { type: 'object', properties: { id: { type: 'string' } } } },
              ],
            },
          },
        },
      },
    }
    const model = extractAsyncApi(document)
    const messages = model.channels[0]?.messages ?? []
    expect(messages.find((m) => m.name === 'avroEvent')?.payload).toBeUndefined()
    expect(messages.find((m) => m.name === 'jsonEvent')?.payload).toBeDefined()
    expect(model.issues.some((issue) => issue.message.includes('avro'))).toBe(true)
  })

  it('applies a trait-contributed schemaFormat before gating the payload', () => {
    // The format lives only on the trait; reading it pre-merge would treat the
    // Avro payload as JSON Schema (the bug the lint preset once had).
    const document = {
      asyncapi: '2.6.0',
      info: { title: 'Traited', version: '1.0.0' },
      channels: {
        events: {
          publish: {
            message: {
              name: 'avroEvent',
              traits: [{ schemaFormat: 'application/vnd.apache.avro;version=1.9.0' }],
              payload: { type: 'record', name: 'Event', fields: [] },
            },
          },
        },
      },
    }
    const model = extractAsyncApi(document)
    expect(model.channels[0]?.messages[0]?.payload).toBeUndefined()
    expect(model.issues.length).toBeGreaterThan(0)
  })

  // The gemini fixture carries authored payload examples; each must satisfy
  // the schema we extracted for its message, or normalization (the draft-07
  // upgrade, the component rebase) changed what the schema accepts. The
  // payload is a $ref into a oneOf of further component refs, so this also
  // exercises transitive component copying end to end.
  it('extracted payload schemas accept the fixtures own message examples', () => {
    const fixture = fixtureNamed('v3.0/websocket-gemini.yaml')
    const model = extractAsyncApi(fixture.document)
    const payload = messageOn(model.channels, 'marketDataV1', 'marketData').payload
    expect(payload).toBeDefined()

    const rawMessage = (
      (fixture.document['components'] as Record<string, unknown>)['messages'] as Record<string, Record<string, unknown>>
    )['marketData']
    const examples = (rawMessage?.['examples'] ?? []) as Record<string, unknown>[]
    expect(examples.length).toBeGreaterThan(0)

    const check = validate(payload as Record<string, unknown>)
    for (const example of examples) {
      expect(check(example['payload']), String(example['name'])).toBe(true)
    }
  })
})
