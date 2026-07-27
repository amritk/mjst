import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'

import { buildSchema } from './build-schema'

/**
 * Keywords the generator used to read past — each one narrows the set of valid
 * documents, so a strict parser that ignores it accepts input the schema
 * rejects, and the emitted type promises fields nothing checks.
 */
const parserFor = async (schema: JSONSchema, strict = true): Promise<string> => {
  const files = await buildSchema(schema, 'Doc', undefined, false, false, strict)
  return files.find((file) => file.filename === 'doc.ts')?.content ?? ''
}

describe('inline allOf members', () => {
  const schema: JSONSchema = {
    type: 'object',
    properties: { a: { type: 'string' } },
    allOf: [{ type: 'object', properties: { b: { type: 'number' } }, required: ['b'] }],
  }

  it('enforces the member required properties in strict mode', async () => {
    expect(await parserFor(schema)).toContain("missing required property 'b'")
  })

  it('enforces the member property types in strict mode', async () => {
    expect(await parserFor(schema)).toContain("field 'b' expected number")
  })

  it('does not let the fast path skip the member assertions', async () => {
    // The guard is built from the schema's own properties, so returning early on
    // it would jump straight over everything the allOf member contributes.
    const parser = await parserFor(schema)
    const fastPathReturn = parser.indexOf('return { ...input } as Doc;')
    const memberAssertion = parser.indexOf("missing required property 'b'")
    expect(fastPathReturn === -1 || memberAssertion < fastPathReturn).toBe(true)
  })

  it('leaves a $ref member to the parser generated for its target', async () => {
    const withRef: JSONSchema = {
      type: 'object',
      properties: { a: { type: 'string' } },
      allOf: [{ $ref: '#/$defs/base' }],
      $defs: { base: { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] } },
    }

    expect(await parserFor(withRef)).not.toContain("missing required property 'b'")
  })
})

describe('required keys with no declared property', () => {
  it('still asserts presence in strict mode', async () => {
    const schema: JSONSchema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a', 'b'] }

    expect(await parserFor(schema)).toContain("missing required property 'b'")
  })
})

describe('draft-07 tuples', () => {
  const schema: JSONSchema = {
    type: 'array',
    items: [{ type: 'string' }, { type: 'number' }],
    additionalItems: false,
  } as JSONSchema

  it('asserts each declared position', async () => {
    const parser = await parserFor(schema)
    expect(parser).toContain('[Doc][0] expected string')
    expect(parser).toContain('[Doc][1] expected number')
  })

  it('caps the length when additionalItems is false', async () => {
    expect(await parserFor(schema)).toContain('must NOT have more than 2 items')
  })

  it('types it as a tuple', async () => {
    expect(await parserFor(schema)).toContain('export type Doc = [string?, number?];')
  })
})

describe('assertion emission', () => {
  it('emits each root tuple assertion once', async () => {
    const schema: JSONSchema = { type: 'array', prefixItems: [{ type: 'string' }] }

    const parser = await parserFor(schema)
    expect(parser.split('[Doc][0] expected string').length - 1).toBe(1)
  })

  it('emits each root item assertion once', async () => {
    const schema: JSONSchema = { type: 'array', items: { type: 'string' } }

    const parser = await parserFor(schema)
    expect(parser.split('items expected string').length - 1).toBe(1)
  })
})

describe('defaults that contradict the declared type', () => {
  it('ignores a string default on an array property', async () => {
    // Left over from an earlier shape of the document (OpenAI's spec does this):
    // honouring it would have a coercing parser "repair" a missing list into a
    // string that fails the very schema it came from.
    const schema: JSONSchema = {
      type: 'object',
      required: ['xs'],
      properties: { xs: { type: 'array', default: 'nope', items: { type: 'string' } } },
    }

    const parser = await parserFor(schema, false)
    expect(parser).not.toContain('"nope"')
    expect(parser).toContain('xs: []')
  })

  it('keeps a default that matches its type', async () => {
    const schema: JSONSchema = {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string', default: 'anon' } },
    }

    expect(await parserFor(schema, false)).toContain('"anon"')
  })
})

describe('self-imports', () => {
  it('does not import from its own file when a definition collides with the root name', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { c: { $ref: '#/$defs/contact' } },
      $defs: { contact: { type: 'object', properties: { email: { type: 'string' } } } },
    }

    const files = await buildSchema(schema, 'Contact')
    const contact = files.find((file) => file.filename === 'contact.ts')?.content ?? ''
    expect(contact).not.toContain("from './contact.js'")
  })
})

describe('URI $ref types', () => {
  it('names the type it imports rather than falling back to unknown', async () => {
    const schema = {
      $schema: 'http://json-schema.org/draft-07/schema',
      type: 'object',
      properties: { channel: { $ref: 'http://asyncapi.com/definitions/3.1.0/channel.json' } },
      definitions: {
        'http://asyncapi.com/definitions/3.1.0/channel.json': {
          type: 'object',
          properties: { address: { type: 'string' } },
        },
      },
    } as unknown as JSONSchema

    const files = await buildSchema(schema, 'Doc')
    const doc = files.find((file) => file.filename === 'doc.ts')?.content ?? ''
    expect(doc).toContain('channel?: Channel;')
    expect(doc).toContain("import { type Channel, parseChannel, validateChannelShape } from './channel.js';")
  })
})
