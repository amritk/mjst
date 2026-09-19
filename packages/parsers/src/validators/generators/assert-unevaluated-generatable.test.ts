import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'

import { assertUnevaluatedGeneratable } from './assert-unevaluated-generatable'
import type { UnevaluatedMatchFn } from './unevaluated-match'

/**
 * The gate that decides, before a line is emitted, whether an `unevaluated*`
 * keyword can be honoured. Its job is to refuse the *shapes* the flat form cannot
 * see through and nothing else — a refusal that covered the keyword outright
 * would be a design decision, and this package already made the opposite one.
 */

const match: UnevaluatedMatchFn = (accessor) => `matches(${accessor})`

const assert = (schema: JSONSchema, rootSchema: Record<string, unknown> = schema as Record<string, unknown>): void =>
  assertUnevaluatedGeneratable(schema, 'Root', rootSchema, match)

describe('assert-unevaluated-generatable', () => {
  it('accepts the shapes the generator can express', () => {
    expect(() => assert({ properties: { a: true }, unevaluatedProperties: false })).not.toThrow()
    expect(() =>
      assert({ allOf: [{ properties: { a: true } }], unevaluatedProperties: { type: 'string' } }),
    ).not.toThrow()
    expect(() => assert({ prefixItems: [true], contains: { type: 'string' }, unevaluatedItems: false })).not.toThrow()
    expect(() =>
      assert({ $ref: '#/$defs/bar', unevaluatedProperties: false, $defs: { bar: { properties: { b: true } } } }),
    ).not.toThrow()
  })

  it('refuses a node whose coverage runs through a ref it cannot follow', () => {
    expect(() => assert({ $dynamicRef: '#node', unevaluatedProperties: false } as JSONSchema)).toThrow(
      /unsupported "unevaluatedProperties"/,
    )
    expect(() => assert({ $ref: '#/$defs/missing', unevaluatedItems: false } as JSONSchema)).toThrow(
      /unsupported "unevaluatedItems"/,
    )
  })

  it('finds a node anywhere the emitter would reach it', () => {
    expect(() =>
      assert({ properties: { a: { $dynamicRef: '#n', unevaluatedProperties: false } } } as JSONSchema),
    ).toThrow(/unsupported "unevaluatedProperties"/)
    expect(() => assert({ not: { $dynamicRef: '#n', unevaluatedProperties: false } } as JSONSchema)).toThrow()
    expect(() => assert({ oneOf: [{ $dynamicRef: '#n', unevaluatedItems: false }] } as JSONSchema)).toThrow()
    expect(() => assert({ contains: { $dynamicRef: '#n', unevaluatedItems: false } } as JSONSchema)).toThrow()
  })

  it('refuses an unevaluated keyword in a position the emitter never enforces', () => {
    // Draft-07 `additionalItems` is only read as `false` here, so a subschema
    // under it is dropped whole — which for a narrowing keyword means the check
    // would silently never run.
    expect(() =>
      assert({ prefixItems: [true], additionalItems: { properties: { a: true }, unevaluatedProperties: false } }),
    ).toThrow(/"additionalItems"/)
  })

  it('leaves definitions to the files generated for them', () => {
    // A referenced `$defs` entry gets its own validator, gated on its own terms
    // and with its own fresh annotation scope; an unreferenced one is never
    // applied to anything. Either way this node is not the place to refuse.
    expect(() =>
      assert({ type: 'object', $defs: { a: { $dynamicRef: '#n', unevaluatedProperties: false } } }),
    ).not.toThrow()
  })

  it('lets `unevaluated*: true` through, since it constrains nothing', () => {
    expect(() => assert({ $dynamicRef: '#node', unevaluatedProperties: true } as JSONSchema)).not.toThrow()
  })

  // `additionalItems` used to be inert everywhere — the generator read it only as
  // `false`, a length cap — so an `unevaluated*` under it could never run and the
  // refusal was always right. Now that the draft-07 tail is validated, the same
  // refusal turns down work the emitter can do.
  it('accepts an unevaluated* under an additionalItems that is the live tail', () => {
    expect(() =>
      assert({
        items: [{ type: 'string' }],
        additionalItems: { properties: { p: true }, unevaluatedProperties: false },
      }),
    ).not.toThrow()
  })

  it('still refuses an unevaluated* under an additionalItems nothing reads', () => {
    // Inert next to a schema-form `items` (2020-12 does not define
    // `additionalItems` at all), and inert again once `prefixItems` has taken the
    // positions — the tail then comes from `items`.
    expect(() =>
      assert({ items: { type: 'number' }, additionalItems: { properties: { p: true }, unevaluatedProperties: false } }),
    ).toThrow(/"additionalItems"/)
    expect(() =>
      assert({
        prefixItems: [{ type: 'string' }],
        items: [{ type: 'number' }],
        additionalItems: { properties: { p: true }, unevaluatedProperties: false },
      }),
    ).toThrow(/"additionalItems"/)
  })
})
