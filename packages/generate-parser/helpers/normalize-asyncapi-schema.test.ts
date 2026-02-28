import { describe, expect, it } from 'vitest'
import { normalizeAsyncApiSchema } from './normalize-asyncapi-schema'

describe('normalize-asyncapi-schema', () => {
  it('converts definitions to $defs with kebab-case keys', () => {
    const schema = {
      type: 'object',
      properties: {
        info: { $ref: 'http://asyncapi.com/definitions/3.1.0/info.json' },
      },
      definitions: {
        'http://asyncapi.com/definitions/3.1.0/info.json': {
          $id: 'http://asyncapi.com/definitions/3.1.0/info.json',
          type: 'object',
          properties: {
            title: { type: 'string' },
          },
        },
      },
    }

    const result = normalizeAsyncApiSchema(schema)

    expect(result['$defs']).toBeDefined()
    expect(result['$defs']).toHaveProperty('info')
    expect(result).not.toHaveProperty('definitions')
  })

  it('rewrites URI $ref values to #/$defs/ format', () => {
    const schema = {
      type: 'object',
      properties: {
        info: { $ref: 'http://asyncapi.com/definitions/3.1.0/info.json' },
      },
      definitions: {
        'http://asyncapi.com/definitions/3.1.0/info.json': {
          type: 'object',
          properties: {
            title: { type: 'string' },
          },
        },
      },
    }

    const result = normalizeAsyncApiSchema(schema)
    const properties = result['properties'] as Record<string, Record<string, string>>

    expect(properties['info']!['$ref']).toBe('#/$defs/info')
  })

  it('handles binding URIs with protocol and version', () => {
    const schema = {
      type: 'object',
      definitions: {
        'http://asyncapi.com/bindings/kafka/0.5.0/channel.json': {
          type: 'object',
          properties: {
            topic: { type: 'string' },
          },
        },
      },
    }

    const result = normalizeAsyncApiSchema(schema)
    const defs = result['$defs'] as Record<string, unknown>

    expect(defs).toHaveProperty('kafka-0-5-0-channel-binding')
  })

  it('handles extension URIs', () => {
    const schema = {
      type: 'object',
      definitions: {
        'http://asyncapi.com/extensions/linkedin/0.1.0/schema.json': {
          type: 'object',
        },
      },
    }

    const result = normalizeAsyncApiSchema(schema)
    const defs = result['$defs'] as Record<string, unknown>

    expect(defs).toHaveProperty('linkedin-0-1-0-schema-extension')
  })

  it('prefixes 3.0.0 definitions with v3-0-0 to avoid collisions', () => {
    const schema = {
      type: 'object',
      definitions: {
        'http://asyncapi.com/definitions/3.1.0/schema.json': {
          type: 'object',
        },
        'http://asyncapi.com/definitions/3.0.0/schema.json': {
          type: 'object',
        },
      },
    }

    const result = normalizeAsyncApiSchema(schema)
    const defs = result['$defs'] as Record<string, unknown>

    expect(defs).toHaveProperty('schema')
    expect(defs).toHaveProperty('v3-0-0-schema')
  })

  it('handles json-schema-draft-07 special case', () => {
    const schema = {
      type: 'object',
      definitions: {
        'http://json-schema.org/draft-07/schema': {
          type: 'object',
        },
      },
    }

    const result = normalizeAsyncApiSchema(schema)
    const defs = result['$defs'] as Record<string, unknown>

    expect(defs).toHaveProperty('json-schema-draft-07')
  })

  it('strips $id fields from definitions', () => {
    const schema = {
      type: 'object',
      definitions: {
        'http://asyncapi.com/definitions/3.1.0/channel.json': {
          $id: 'http://asyncapi.com/definitions/3.1.0/channel.json',
          type: 'object',
        },
      },
    }

    const result = normalizeAsyncApiSchema(schema)
    const defs = result['$defs'] as Record<string, Record<string, unknown>>

    expect(defs['channel']).not.toHaveProperty('$id')
  })

  it('strips $schema from the root', () => {
    const schema = {
      $schema: 'http://json-schema.org/draft-07/schema',
      type: 'object',
      definitions: {},
    }

    const result = normalizeAsyncApiSchema(schema)

    expect(result).not.toHaveProperty('$schema')
  })

  it('converts self-referencing $ref: "#" to point to the definition itself', () => {
    const schema = {
      type: 'object',
      definitions: {
        'http://json-schema.org/draft-07/schema': {
          type: 'object',
          properties: {
            additionalProperties: { $ref: '#' },
          },
        },
      },
    }

    const result = normalizeAsyncApiSchema(schema)
    const defs = result['$defs'] as Record<string, Record<string, Record<string, Record<string, string>>>>

    // Non-null assertions are safe: the test input guarantees this path exists
    expect(defs['json-schema-draft-07']!['properties']!['additionalProperties']!['$ref']).toBe(
      '#/$defs/json-schema-draft-07',
    )
  })

  it('rewrites nested $ref values inside oneOf and anyOf', () => {
    const schema = {
      type: 'object',
      definitions: {
        'http://asyncapi.com/definitions/3.1.0/channel.json': {
          type: 'object',
        },
        'http://asyncapi.com/definitions/3.1.0/Reference.json': {
          type: 'object',
        },
        'http://asyncapi.com/definitions/3.1.0/channels.json': {
          type: 'object',
          additionalProperties: {
            oneOf: [
              { $ref: 'http://asyncapi.com/definitions/3.1.0/Reference.json' },
              { $ref: 'http://asyncapi.com/definitions/3.1.0/channel.json' },
            ],
          },
        },
      },
    }

    const result = normalizeAsyncApiSchema(schema)
    const defs = result['$defs'] as Record<string, Record<string, Record<string, Array<Record<string, string>>>>>

    // Non-null assertions are safe: the test input guarantees these paths exist
    expect(defs['channels']!['additionalProperties']!['oneOf']![0]!['$ref']).toBe('#/$defs/reference')
    expect(defs['channels']!['additionalProperties']!['oneOf']![1]!['$ref']).toBe('#/$defs/channel')
  })

  it('converts camelCase definition names to kebab-case and strips Object suffix', () => {
    const schema = {
      type: 'object',
      definitions: {
        'http://asyncapi.com/definitions/3.1.0/channelBindingsObject.json': {
          type: 'object',
        },
        'http://asyncapi.com/definitions/3.1.0/messageExampleObject.json': {
          type: 'object',
        },
      },
    }

    const result = normalizeAsyncApiSchema(schema)
    const defs = result['$defs'] as Record<string, unknown>

    // "Object" suffix is stripped so the pipeline does not produce double "Object"
    // (e.g., "ChannelBindingsObjectObject")
    expect(defs).toHaveProperty('channel-bindings')
    expect(defs).toHaveProperty('message-example')
  })

  it('preserves non-definition root properties', () => {
    const schema = {
      $id: 'http://asyncapi.com/definitions/3.1.0/asyncapi.json',
      type: 'object',
      required: ['asyncapi', 'info'],
      properties: {
        asyncapi: { type: 'string', const: '3.1.0' },
      },
      definitions: {},
    }

    const result = normalizeAsyncApiSchema(schema)

    expect(result['type']).toBe('object')
    expect(result['required']).toEqual(['asyncapi', 'info'])
    expect(result['properties']).toBeDefined()
  })

  it('hoists local definitions to root $defs with parent prefix', () => {
    const schema = {
      type: 'object',
      definitions: {
        'http://json-schema.org/draft-07/schema': {
          type: 'object',
          definitions: {
            schemaArray: {
              type: 'array',
              items: { $ref: '#' },
            },
          },
          properties: {
            items: { $ref: '#/definitions/schemaArray' },
          },
        },
      },
    }

    const result = normalizeAsyncApiSchema(schema)
    const defs = result['$defs'] as Record<string, Record<string, unknown>>
    const draft07 = defs['json-schema-draft-07']

    // Nested $defs should be hoisted to root and removed from parent
    expect(draft07).not.toHaveProperty('$defs')
    expect(draft07).not.toHaveProperty('definitions')

    // The hoisted def should exist at the root with a prefixed name
    expect(defs).toHaveProperty('json-schema-draft-07-schema-array')

    // Self-refs within hoisted defs should still point to the parent
    // Non-null assertion is safe: the test input guarantees this path exists
    const hoistedSchemaArray = defs['json-schema-draft-07-schema-array'] as Record<string, Record<string, string>>
    expect(hoistedSchemaArray['items']!['$ref']).toBe('#/$defs/json-schema-draft-07')

    // Parent refs to local defs should now point to the hoisted root-level defs
    const properties = draft07?.['properties'] as Record<string, Record<string, string>>
    expect(properties['items']!['$ref']).toBe('#/$defs/json-schema-draft-07-schema-array')
  })

  it('handles URI refs with trailing hash (e.g., schema#)', () => {
    const schema = {
      type: 'object',
      definitions: {
        'http://json-schema.org/draft-07/schema': {
          type: 'object',
        },
        'http://asyncapi.com/definitions/3.1.0/schema.json': {
          allOf: [
            { $ref: 'http://json-schema.org/draft-07/schema#' },
            { type: 'object' },
          ],
        },
      },
    }

    const result = normalizeAsyncApiSchema(schema)
    const defs = result['$defs'] as Record<string, Record<string, Array<Record<string, string>>>>

    // The trailing "#" should be stripped so the ref maps to the correct definition
    // Non-null assertions are safe: the test input guarantees this path exists
    expect(defs['schema']!['allOf']![0]!['$ref']).toBe('#/$defs/json-schema-draft-07')
  })

  it('strips Object suffix from definition names to prevent double suffixing', () => {
    const schema = {
      type: 'object',
      properties: {
        bindings: { $ref: 'http://asyncapi.com/definitions/3.1.0/channelBindingsObject.json' },
        message: { $ref: 'http://asyncapi.com/definitions/3.1.0/messageObject.json' },
      },
      definitions: {
        'http://asyncapi.com/definitions/3.1.0/channelBindingsObject.json': {
          type: 'object',
        },
        'http://asyncapi.com/definitions/3.1.0/messageObject.json': {
          type: 'object',
        },
      },
    }

    const result = normalizeAsyncApiSchema(schema)
    const defs = result['$defs'] as Record<string, unknown>
    const props = result['properties'] as Record<string, Record<string, string>>

    // Definition names should not contain "object" so refToName produces
    // "ChannelBindingsObject" instead of "ChannelBindingsObjectObject"
    expect(defs).toHaveProperty('channel-bindings')
    expect(defs).toHaveProperty('message')
    expect(props['bindings']!['$ref']).toBe('#/$defs/channel-bindings')
    expect(props['message']!['$ref']).toBe('#/$defs/message')
  })

  it('preserves boolean schema definitions without treating them as objects to hoist', () => {
    // A boolean schema (e.g. `true` or `false`) is a valid JSON Schema but is not an object.
    // hoistNestedDefs must not try to access properties on it and just copy it as-is.
    const schema = {
      type: 'object',
      definitions: {
        'allow-all': true,
        'deny-all': false,
      },
    }

    const result = normalizeAsyncApiSchema(schema)
    const defs = result['$defs'] as Record<string, unknown>

    expect(defs['allow-all']).toBe(true)
    expect(defs['deny-all']).toBe(false)
  })

  it('rewrites local refs inside array-valued schema keywords when hoisting nested defs', () => {
    // When a parent definition contains anyOf (an array) with internal $ref values,
    // rewriteLocalRefs must handle the array case so the refs are updated to point
    // at the hoisted equivalents.
    const schema = {
      type: 'object',
      definitions: {
        'json-schema': {
          $defs: {
            stringSchema: { type: 'string' },
          },
          anyOf: [{ $ref: '#/$defs/stringSchema' }, { type: 'number' }],
        },
      },
    }

    const result = normalizeAsyncApiSchema(schema)
    const defs = result['$defs'] as Record<string, unknown>
    const jsonSchema = defs['json-schema'] as Record<string, Array<Record<string, string>>>

    // The nested def should be hoisted with a prefixed name
    expect(defs).toHaveProperty('json-schema-string-schema')

    // The ref inside anyOf must be rewritten to the hoisted location
    expect(jsonSchema['anyOf']![0]!['$ref']).toBe('#/$defs/json-schema-string-schema')
  })
})
