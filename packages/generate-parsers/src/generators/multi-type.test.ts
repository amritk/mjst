import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'

import { buildSchema } from './build-schema'

/**
 * An array-form `type` (`["string","null"]`) — and its OpenAPI 3.0 spelling,
 * `nullable: true` — reads as false to the `hasType` guard every code path here
 * is built on. That made a nullable property invisible: no fast-path check, no
 * strict assertion, and a coercing parser that replaced a valid `null` with the
 * type's default. These fix that end to end.
 */
const parserFor = async (schema: JSONSchema, strict: boolean): Promise<string> => {
  const files = await buildSchema(schema, 'Doc', undefined, false, false, strict)
  return files.find((file) => file.filename === 'doc.ts')?.content ?? ''
}

describe('multi-type properties', () => {
  it('asserts the disjunction in strict mode instead of emitting no check', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { a: { type: ['string', 'null'] } },
      required: ['a'],
    }

    const parser = await parserFor(schema, true)
    expect(parser).toContain('(typeof input.a === "string") || (input.a === null)')
    expect(parser).toContain('expected string | null')
  })

  it('guards an optional multi-type property on presence', async () => {
    const schema: JSONSchema = { type: 'object', properties: { a: { type: ['number', 'null'] } } }

    expect(await parserFor(schema, true)).toContain('if (input.a !== undefined && !')
  })

  it('still enforces the constraints of the non-null member', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { a: { type: ['array', 'null'], items: { type: 'string' } } },
      required: ['a'],
    }

    expect(await parserFor(schema, true)).toContain('items expected string')
  })

  it('keeps a real shape validator rather than the always-false stub', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { a: { type: ['string', 'null'] } },
      required: ['a'],
    }

    const parser = await parserFor(schema, false)
    expect(parser).not.toContain('validateDocShape = (_input: unknown): boolean => false')
    expect(parser).toContain('(typeof input.a === "string") || (input.a === null)')
  })

  it('leaves the fast path alone when a constraint keyword rides along', async () => {
    // A bare `typeof` disjunction would wave a too-short string through, so the
    // fast path has to bail — it must only ever return true for valid values.
    const schema: JSONSchema = {
      type: 'object',
      properties: { a: { type: ['string', 'null'], minLength: 5 } },
      required: ['a'],
    }

    const parser = await parserFor(schema, false)
    expect(parser).toContain('validateDocShape = (_input: unknown): boolean => false')
  })

  it('asserts an array-form type at the root', async () => {
    const schema: JSONSchema = { type: ['string', 'null'] }

    expect(await parserFor(schema, true)).toContain('expected string | null')
  })

  it('does not route a nullable object property through an object-only sub-parser', async () => {
    // The sub-parser opens with `isObject` and throws on null, so claiming a
    // nullable object property would reject a value the schema allows.
    const schema: JSONSchema = {
      type: 'object',
      properties: { a: { type: ['object', 'null'], properties: { b: { type: 'string' } } } },
    }

    expect(await parserFor(schema, true)).not.toContain('parseDoc_A')
  })
})

describe('nullable: true (OpenAPI 3.0)', () => {
  it('accepts null for a nullable property in strict mode', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { name: { type: 'string', nullable: true } },
      required: ['name'],
    } as JSONSchema

    const parser = await parserFor(schema, true)
    expect(parser).toContain('name: string | null;')
    expect(parser).toContain('(input.name === null)')
  })

  it('still rejects a wrong type for a nullable property', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { name: { type: 'string', nullable: true } },
      required: ['name'],
    } as JSONSchema

    expect(await parserFor(schema, true)).toContain('expected string | null')
  })

  it('folds nullable inside a $ref target too', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { user: { $ref: '#/$defs/user' } },
      $defs: { user: { type: 'object', properties: { nick: { type: 'string', nullable: true } } } },
    } as JSONSchema

    const files = await buildSchema(schema, 'Doc', undefined, false, false, true)
    expect(files.find((file) => file.filename === 'user.ts')?.content).toContain('nick?: string | null;')
  })
})
