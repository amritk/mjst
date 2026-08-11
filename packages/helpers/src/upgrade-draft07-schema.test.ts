import { describe, expect, it } from 'vitest'

import { resolveRef } from './resolve-ref'
import { isDraft07Schema, upgradeDraft07Schema } from './upgrade-draft07-schema'

describe('upgrade-draft07-schema', () => {
  const draft07 = <T extends Record<string, unknown>>(schema: T): Record<string, unknown> => ({
    $schema: 'http://json-schema.org/draft-07/schema#',
    ...schema,
  })

  it('recognises a draft-07 document by its $schema', () => {
    expect(isDraft07Schema({ $schema: 'http://json-schema.org/draft-07/schema#' })).toBe(true)
    expect(isDraft07Schema({ $schema: 'https://json-schema.org/draft/2020-12/schema' })).toBe(false)
    expect(isDraft07Schema({})).toBe(false)
  })

  it('leaves a document that is not draft-07 untouched', () => {
    const schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', definitions: { a: { type: 'string' } } }
    expect(upgradeDraft07Schema(schema)).toBe(schema)
  })

  it('renames the root definitions block to $defs', () => {
    expect(upgradeDraft07Schema(draft07({ definitions: { thing: { type: 'string' } } }))).toEqual({
      $defs: { thing: { type: 'string' } },
    })
  })

  // The rename moves the block, so every pointer written against the old name has
  // to move with it. Refs written *inside* `definitions` were always rewritten;
  // refs written anywhere else were not, and since the block they name no longer
  // exists the generators stopped with "Could not resolve $ref" — a draft-07
  // document with an ordinary `properties: { a: { $ref: "#/definitions/x" } }`
  // could not be generated at all.
  const OUTSIDE_DEFINITIONS: readonly { where: string; schema: Record<string, unknown> }[] = [
    { where: 'a property', schema: { properties: { a: { $ref: '#/definitions/thing' } } } },
    { where: 'the document root', schema: { $ref: '#/definitions/thing' } },
    { where: 'items', schema: { type: 'array', items: { $ref: '#/definitions/thing' } } },
    { where: 'a tuple position', schema: { type: 'array', items: [{ $ref: '#/definitions/thing' }] } },
    { where: 'allOf', schema: { allOf: [{ $ref: '#/definitions/thing' }] } },
    { where: 'additionalProperties', schema: { additionalProperties: { $ref: '#/definitions/thing' } } },
    { where: 'patternProperties', schema: { patternProperties: { '^a': { $ref: '#/definitions/thing' } } } },
    { where: 'not', schema: { not: { $ref: '#/definitions/thing' } } },
    { where: 'if/then', schema: { if: { type: 'string' }, then: { $ref: '#/definitions/thing' } } },
    {
      where: 'a nested property',
      schema: { properties: { a: { properties: { b: { $ref: '#/definitions/thing' } } } } },
    },
  ]

  for (const { where, schema } of OUTSIDE_DEFINITIONS) {
    it(`rewrites a #/definitions ref written in ${where}`, () => {
      const upgraded = JSON.stringify(upgradeDraft07Schema(draft07({ ...schema, definitions: { thing: {} } })))
      expect(upgraded).toContain('#/$defs/thing')
      expect(upgraded).not.toContain('#/definitions/thing')
    })
  }

  it('keeps rewriting refs written inside definitions', () => {
    const upgraded = upgradeDraft07Schema(
      draft07({
        definitions: {
          thing: { type: 'string' },
          holder: { properties: { a: { $ref: '#/definitions/thing' } } },
        },
      }),
    )
    expect(upgraded).toEqual({
      $defs: {
        thing: { type: 'string' },
        holder: { properties: { a: { $ref: '#/$defs/thing' } } },
      },
    })
  })

  it('does not touch a ref that names something other than definitions', () => {
    // Only the block that actually moved gets rewritten. A pointer into
    // `properties`, an anchor, or an external URI still means what it said.
    const upgraded = upgradeDraft07Schema(
      draft07({
        properties: {
          a: { $ref: '#/properties/b' },
          b: { $ref: '#thing' },
          c: { $ref: 'https://example.com/other.json#/definitions/thing' },
        },
        definitions: { thing: {} },
      }),
    )
    expect(upgraded['properties']).toEqual({
      a: { $ref: '#/properties/b' },
      b: { $ref: '#thing' },
      c: { $ref: 'https://example.com/other.json#/definitions/thing' },
    })
  })

  it('leaves a property literally named "definitions" in place', () => {
    // The rename applies to the keyword, not to every key spelled that way: a
    // document describing an object with a `definitions` field still describes
    // that field, and its ref has to keep pointing at it.
    const upgraded = upgradeDraft07Schema(
      draft07({ properties: { definitions: { type: 'object' }, a: { $ref: '#/properties/definitions' } } }),
    )
    expect(upgraded['properties']).toEqual({
      definitions: { type: 'object' },
      a: { $ref: '#/properties/definitions' },
    })
  })

  it('hoists a nested definitions block to the root with a prefixed name', () => {
    const upgraded = upgradeDraft07Schema(
      draft07({
        definitions: {
          parent: { definitions: { child: { type: 'number' } }, properties: { c: { $ref: '#/definitions/child' } } },
        },
      }),
    )
    const defs = upgraded['$defs'] as Record<string, unknown>
    expect(defs['parent-child']).toEqual({ type: 'number' })
    expect((defs['parent'] as Record<string, unknown>)['properties']).toEqual({ c: { $ref: '#/$defs/parent-child' } })
  })

  it('leaves a ref inside an embedded $id resource alone', () => {
    // An `$id` starts a new resource, and `#/definitions/b` inside it addresses
    // that resource's own block — which is not hoisted and not renamed, because
    // only the root document's `definitions` is. Rewriting the pointer there aims
    // it at nothing, and `assertIdScopes` turns that into a hard failure for a
    // document that upgraded fine before. The root's own refs still rewrite.
    const upgraded = upgradeDraft07Schema(
      draft07({
        properties: {
          outer: { $ref: '#/definitions/a' },
          inner: {
            $id: 'https://example.test/inner',
            properties: { x: { $ref: '#/definitions/b' } },
            definitions: { b: { type: 'string' } },
          },
        },
        definitions: { a: { type: 'number' } },
      }),
    )

    const properties = upgraded['properties'] as Record<string, Record<string, unknown>>
    expect(properties['outer']).toEqual({ $ref: '#/$defs/a' })
    expect((properties['inner'] as Record<string, Record<string, unknown>>)['properties']).toEqual({
      x: { $ref: '#/definitions/b' },
    })
    expect(upgraded['$defs']).toEqual({ a: { type: 'number' } })
  })

  it('leaves a ref-shaped literal inside a data keyword alone', () => {
    // `enum` / `const` / `default` / `examples` hold instance data. An object
    // spelled `{"$ref": …}` there is a value the document declares, not a
    // reference to follow, and rewriting it silently changes the declared value.
    const upgraded = upgradeDraft07Schema(
      draft07({
        properties: {
          a: {
            $ref: '#/definitions/a',
            default: { $ref: '#/definitions/a' },
            const: { $ref: '#/definitions/a' },
            enum: [{ $ref: '#/definitions/a' }],
            examples: [{ $ref: '#/definitions/a' }],
          },
        },
        definitions: { a: { type: 'string' } },
      }),
    )

    const a = (upgraded['properties'] as Record<string, Record<string, unknown>>)['a'] as Record<string, unknown>
    // The real reference still rewrites; the four literals beside it do not.
    expect(a['$ref']).toBe('#/$defs/a')
    expect(a['default']).toEqual({ $ref: '#/definitions/a' })
    expect(a['const']).toEqual({ $ref: '#/definitions/a' })
    expect(a['enum']).toEqual([{ $ref: '#/definitions/a' }])
    expect(a['examples']).toEqual([{ $ref: '#/definitions/a' }])
  })

  it('keeps a property named __proto__ as an own property', () => {
    // Assigning `__proto__` with `result[key] =` runs the prototype setter rather
    // than creating a property, so the key vanishes from the output.
    // Built from JSON text: an object *literal* with a `__proto__` key sets the
    // prototype instead of creating the property, so a fixture written that way
    // would not exercise this at all. `JSON.parse` makes it an own property,
    // which is exactly what reading a schema off disk does.
    const schema = JSON.parse(
      `{"$schema":"http://json-schema.org/draft-07/schema#","type":"object",` +
        `"properties":{"__proto__":{"$ref":"#/definitions/a"},"ok":{"type":"string"}},` +
        `"definitions":{"a":{"type":"string"}}}`,
    )

    const upgraded = upgradeDraft07Schema(schema)
    const properties = upgraded['properties'] as Record<string, unknown>

    expect(Object.hasOwn(properties, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(properties)).toBe(Object.prototype)
    // And it is still upgraded like any other property.
    expect(Object.getOwnPropertyDescriptor(properties, '__proto__')?.value).toEqual({ $ref: '#/$defs/a' })
    expect(properties['ok']).toEqual({ type: 'string' })
  })

  it('drops the draft-07 $schema declaration', () => {
    expect(upgradeDraft07Schema(draft07({ type: 'string' }))).toEqual({ type: 'string', $defs: {} })
  })

  it('keeps a property named __proto__ instead of setting the prototype', () => {
    // A schema may describe a property called `__proto__`. Rebuilding the node
    // with `result[key] = …` ran the prototype setter instead of adding a key:
    // the property vanished from the output — every constraint on it with it —
    // and the rebuilt object silently inherited the subschema. The input is
    // parsed rather than written as a literal, because an object literal's
    // `__proto__:` is the same setter and would never create the key at all.
    const schema = JSON.parse(`{
      "$schema": "http://json-schema.org/draft-07/schema#",
      "type": "object",
      "definitions": {
        "X": { "type": "object", "properties": { "__proto__": { "type": "string" }, "ok": { "type": "string" } } }
      },
      "properties": { "a": { "$ref": "#/definitions/X" } }
    }`) as Record<string, unknown>

    const upgraded = upgradeDraft07Schema(schema) as Record<string, Record<string, Record<string, unknown>>>
    const properties = upgraded['$defs']?.['X']?.['properties'] as object

    expect(Object.getOwnPropertyNames(properties).sort()).toEqual(['__proto__', 'ok'])
    expect(Object.getOwnPropertyDescriptor(properties, '__proto__')?.value).toEqual({ type: 'string' })
    // The subschema must not have become the map's prototype.
    expect(Object.getPrototypeOf(properties)).toBe(Object.prototype)
  })

  it('keeps a definition named __proto__ and the ref that points at it', () => {
    // The root `definitions` map was rebuilt with a plain assignment, so the
    // definition set the map's prototype and vanished — while the `$ref` to it
    // was still rewritten to `#/$defs/__proto__`, which now resolves to
    // nothing, failing the build on a document that declares it right there.
    const schema = JSON.parse(`{
      "$schema": "http://json-schema.org/draft-07/schema#",
      "definitions": { "__proto__": { "type": "string" }, "ok": { "type": "number" } },
      "properties": { "a": { "$ref": "#/definitions/__proto__" } }
    }`) as Record<string, unknown>

    const upgraded = upgradeDraft07Schema(schema) as Record<string, Record<string, unknown>>
    const defs = upgraded['$defs'] as object

    expect(Object.getOwnPropertyNames(defs).sort()).toEqual(['__proto__', 'ok'])
    expect(Object.getOwnPropertyDescriptor(defs, '__proto__')?.value).toEqual({ type: 'string' })
    expect(resolveRef('#/$defs/__proto__', upgraded as never)).toEqual({ type: 'string' })
  })
})
