import { describe, expect, it } from 'vitest'
import { dereferenceSchema } from '#helpers/dereference'
import { MAX_SCHEMA_DEPTH } from '#helpers/schema-shape'
import { collectProperties, hasProperties } from '#reference/collect-properties'
import type { SchemaProperty } from '#types/schema'

const names = (node: SchemaProperty): readonly string[] => Object.keys(collectProperties(node).properties)
const required = (node: SchemaProperty): readonly string[] => [...collectProperties(node).required]

describe('collect-properties', () => {
  it('reads a node own properties and requirements', () => {
    const node = { properties: { a: {}, b: {} }, required: ['a'] }
    expect(names(node)).toEqual(['a', 'b'])
    expect(required(node)).toEqual(['a'])
  })

  it('merges every allOf branch, properties and requirements alike', () => {
    const node = {
      allOf: [
        { properties: { a: {} }, required: ['a'] },
        { properties: { b: {} }, required: ['b'] },
      ],
    }
    expect(names(node)).toEqual(['a', 'b'])
    expect(required(node)).toEqual(['a', 'b'])
  })

  // A field is required only when every alternative that could be an object
  // requires it.
  it('intersects the requirements of alternatives', () => {
    const node = {
      anyOf: [
        { type: 'object', properties: { a: {}, b: {} }, required: ['a', 'b'] },
        { type: 'object', properties: { a: {} }, required: ['a'] },
      ],
    }
    expect(required(node)).toEqual(['a'])
  })

  it('excludes a branch that cannot be an object from the intersection', () => {
    const byType = { anyOf: [{ type: 'string' }, { type: 'object', properties: { a: {} }, required: ['a'] }] }
    expect(required(byType)).toEqual(['a'])

    const byEnum = { anyOf: [{ enum: ['x', 'y'] }, { type: 'object', properties: { a: {} }, required: ['a'] }] }
    expect(required(byEnum)).toEqual(['a'])

    const byConst = { anyOf: [{ const: 'x' }, { type: 'object', properties: { a: {} }, required: ['a'] }] }
    expect(required(byConst)).toEqual(['a'])

    // `["object","null"]` is the ordinary nullable-object spelling, and it can
    // be an object — so it votes, and the alternative is not required.
    const nullable = {
      anyOf: [{ type: ['object', 'null'] }, { type: 'object', properties: { a: {} }, required: ['a'] }],
    }
    expect(required(nullable)).toEqual([])

    // The same spelling of a type that cannot: read as "no declared type" this
    // would vote, and strip the marker off the object alternative.
    const nullableString = {
      anyOf: [{ type: ['string', 'null'] }, { type: 'object', properties: { a: {} }, required: ['a'] }],
    }
    expect(required(nullableString)).toEqual(['a'])
  })

  // A mixed enum can be an object, so it votes like any other object branch.
  it('lets an enum that admits an object vote', () => {
    const node = {
      anyOf: [{ enum: [{ mode: 'x' }, 'off'] }, { type: 'object', properties: { a: {} }, required: ['a'] }],
    }
    expect(required(node)).toEqual([])
  })

  it('ignores a required entry that is not a name', () => {
    expect(required({ properties: { a: {} }, required: ['a', 1, null] } as never)).toEqual(['a'])
  })

  // A branch that names no fields still constrains objects: a document taking
  // it has none of the other branch's fields.
  it('lets a free-form object branch keep the alternative optional', () => {
    const node = {
      anyOf: [
        { type: 'object', additionalProperties: { type: 'string' } },
        { type: 'object', properties: { a: {} }, required: ['a'] },
      ],
    }
    expect(required(node)).toEqual([])
  })

  // The branch describes a string; reading only its own `type` missed that.
  it('follows allOf when deciding whether a branch could be an object', () => {
    const node = {
      oneOf: [{ allOf: [{ type: 'string' }] }, { type: 'object', properties: { a: {} }, required: ['a'] }],
    }
    expect(required(node)).toEqual(['a'])
  })

  // The stub a recursive $ref collapses to is a truncation marker, not a schema
  // the author wrote — read as one it says "an object requiring nothing", and
  // it stripped the markers off every other branch of a recursive union.
  it('does not let a recursion stub vote on what an alternative requires', () => {
    const variants = [{ $ref: '#/$defs/group' }, { $ref: '#/$defs/link' }]
    const document = {
      $defs: {
        group: {
          type: 'object',
          required: ['kind'],
          properties: { kind: {}, children: { type: 'array', items: { anyOf: variants } } },
        },
        link: { type: 'object', required: ['kind'], properties: { kind: {} } },
      },
      properties: { item: { anyOf: variants } },
    }
    const inlined = dereferenceSchema(document) as SchemaProperty
    const item = inlined.properties?.['item'] as SchemaProperty
    // The outer union settles it: both alternatives require `kind`.
    expect(required(item)).toEqual(['kind'])
    // And so does the inner one, where `group` has collapsed to the stub.
    const children = collectProperties(item).properties['children'] as SchemaProperty
    const nested = (children.items as SchemaProperty) ?? {}
    expect(required(nested)).toEqual(['kind'])
  })

  it('takes properties from conditionals without taking their requirements', () => {
    const node = {
      properties: { a: {} },
      then: { properties: { b: {} }, required: ['b'] },
      else: { properties: { c: {} }, required: ['c'] },
      dependentSchemas: { a: { properties: { d: {} }, required: ['d'] } },
    }
    expect(names(node)).toEqual(['a', 'b', 'c', 'd'])
    expect(required(node)).toEqual([])
  })

  // Draft-07's spelling of `dependentSchemas`, whose value is either a schema
  // or a list of property names — the list has no properties to contribute.
  it('reads the schema form of draft-07 dependencies and skips the list form', () => {
    const node = {
      properties: { a: {} },
      dependencies: { a: { properties: { b: {} } }, c: ['a'] },
    }
    expect(names(node as never)).toEqual(['a', 'b'])
  })

  it('answers whether anything is documented below a node', () => {
    expect(hasProperties({ type: 'string' })).toBe(false)
    expect(hasProperties({ anyOf: [{ type: 'boolean' }, { properties: { a: {} } }] })).toBe(true)
  })

  // Every other cap in the package throws rather than dropping content in
  // silence; a fourteen-level chain used to lose its innermost fields.
  it('refuses composition deeper than it can follow', () => {
    let node: SchemaProperty = { properties: { deepest: {} } }
    for (let level = 0; level <= MAX_SCHEMA_DEPTH + 1; level++) node = { allOf: [node] }
    expect(() => collectProperties(node)).toThrow(/passed \d+ levels/)
  })
})
