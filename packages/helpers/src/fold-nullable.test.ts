import { describe, expect, it } from 'vitest'

import { foldNullable } from './fold-nullable'

describe('foldNullable', () => {
  it('adds null to a string type', () => {
    expect(foldNullable({ type: 'string', nullable: true })).toEqual({ type: ['string', 'null'], nullable: true })
  })

  it('adds null to an array-form type', () => {
    expect(foldNullable({ type: ['string', 'number'], nullable: true })).toEqual({
      type: ['string', 'number', 'null'],
      nullable: true,
    })
  })

  it('leaves an already-nullable type alone', () => {
    const schema = { type: ['string', 'null'], nullable: true }
    expect(foldNullable(schema)).toBe(schema)
  })

  it('folds nested properties and array items', () => {
    expect(
      foldNullable({
        type: 'object',
        properties: {
          a: { type: 'string', nullable: true },
          b: { type: 'array', items: { type: 'number', nullable: true } },
        },
      }),
    ).toEqual({
      type: 'object',
      properties: {
        a: { type: ['string', 'null'], nullable: true },
        b: { type: 'array', items: { type: ['number', 'null'], nullable: true } },
      },
    })
  })

  it('leaves a nullable node with no type alone — there is no type list to extend', () => {
    const schema = { $ref: '#/$defs/thing', nullable: true }
    expect(foldNullable(schema)).toBe(schema)
  })

  it('returns the same reference when nothing needs folding', () => {
    const schema = { type: 'object', properties: { a: { type: 'string' } } }
    expect(foldNullable(schema)).toBe(schema)
  })

  it('ignores a falsy nullable', () => {
    const schema = { type: 'string', nullable: false }
    expect(foldNullable(schema)).toBe(schema)
  })

  it('keeps a property named __proto__ when a sibling folds', () => {
    // The rebuild is only entered when something changed, so the sibling's
    // `nullable` is what exposes the drop. Parsed rather than written as a
    // literal: an object literal's `__proto__:` is the prototype setter.
    const node = JSON.parse(
      '{"type":"object","properties":{"__proto__":{"type":"string"},"ok":{"type":"string","nullable":true}}}',
    ) as Record<string, unknown>

    const folded = foldNullable(node) as Record<string, object>
    const properties = folded['properties'] as object

    expect(Object.getOwnPropertyNames(properties).sort()).toEqual(['__proto__', 'ok'])
    expect(Object.getPrototypeOf(properties)).toBe(Object.prototype)
  })

  it('folds a property whose name matches a data keyword', () => {
    // `properties` maps author-chosen names to schemas, so `default` there is
    // a property name and not the keyword. Skipping it by name left the
    // subschema unfolded while the type generator still widened the emitted
    // type with `| null` — a parser rejecting a null its own type allows.
    const folded = foldNullable({
      type: 'object',
      properties: {
        default: { type: 'string', nullable: true },
        ok: { type: 'string', nullable: true },
      },
    } as never) as { properties: Record<string, { type: unknown }> }

    expect(folded.properties['default']?.type).toEqual(['string', 'null'])
    expect(folded.properties['ok']?.type).toEqual(['string', 'null'])
  })

  it('still leaves a real default value alone', () => {
    const schema = { type: 'object', default: { type: 'string', nullable: true } }
    expect(foldNullable(schema)).toBe(schema)
  })
})
