import { describe, expect, expectTypeOf, it } from 'vitest'

import type { FromSchema } from './from-schema'
import type { Infer } from './infer'
import type { Check, Guard } from './types'
import { validate } from './validate'
import { validateGuard } from './validate-guard'

/**
 * These are type-level tests: every assertion is checked by `tsgo` during
 * `types:check`, and runs as a harmless no-op under Vitest. They guard the
 * structural mirror `FromSchema` keeps of the runtime interpreter, so the two do
 * not silently drift apart.
 */
describe('from-schema', () => {
  it('maps primitive type keywords', () => {
    expectTypeOf<FromSchema<{ type: 'string' }>>().toEqualTypeOf<string>()
    expectTypeOf<FromSchema<{ type: 'number' }>>().toEqualTypeOf<number>()
    expectTypeOf<FromSchema<{ type: 'boolean' }>>().toEqualTypeOf<boolean>()
    expectTypeOf<FromSchema<{ type: 'null' }>>().toEqualTypeOf<null>()
  })

  it('treats integer as number, since TypeScript cannot express integrality', () => {
    expectTypeOf<FromSchema<{ type: 'integer' }>>().toEqualTypeOf<number>()
  })

  it('leaves runtime-only string and number constraints as the base type', () => {
    expectTypeOf<FromSchema<{ type: 'string'; minLength: 1; pattern: '^x' }>>().toEqualTypeOf<string>()
    expectTypeOf<FromSchema<{ type: 'number'; minimum: 0; multipleOf: 2 }>>().toEqualTypeOf<number>()
  })

  it('unions an array of type names', () => {
    expectTypeOf<FromSchema<{ type: ['string', 'number'] }>>().toEqualTypeOf<string | number>()
    expectTypeOf<FromSchema<{ type: ['string', 'null'] }>>().toEqualTypeOf<string | null>()
  })

  it('pins a const to its literal value', () => {
    expectTypeOf<FromSchema<{ const: 'admin' }>>().toEqualTypeOf<'admin'>()
    expectTypeOf<FromSchema<{ const: 42 }>>().toEqualTypeOf<42>()
  })

  it('unions enum members', () => {
    expectTypeOf<FromSchema<{ enum: ['admin', 'user'] }>>().toEqualTypeOf<'admin' | 'user'>()
    expectTypeOf<FromSchema<{ enum: [1, 2, 3] }>>().toEqualTypeOf<1 | 2 | 3>()
  })

  it('intersects an x-mjst brand onto the base type, matching the codegen shape', () => {
    expectTypeOf<FromSchema<{ type: 'string'; 'x-mjst': { brand: 'UserId' } }>>().toEqualTypeOf<
      string & { readonly __brand: 'UserId' }
    >()
    // Runtime constraints still contribute no extra type; only the brand is added.
    expectTypeOf<FromSchema<{ type: 'integer'; minimum: 1; 'x-mjst': { brand: 'OrderId' } }>>().toEqualTypeOf<
      number & { readonly __brand: 'OrderId' }
    >()
  })

  it('brands a property so it is not interchangeable with the unbranded base', () => {
    type Result = FromSchema<{
      type: 'object'
      properties: { id: { type: 'string'; 'x-mjst': { brand: 'UserId' } } }
      required: ['id']
    }>
    expectTypeOf<Result['id']>().toEqualTypeOf<string & { readonly __brand: 'UserId' }>()
    expectTypeOf<Result['id']>().not.toEqualTypeOf<string>()
  })

  it('keeps null assignable when a nullable schema is branded', () => {
    expectTypeOf<FromSchema<{ type: 'string'; nullable: true; 'x-mjst': { brand: 'UserId' } }>>().toEqualTypeOf<
      (string & { readonly __brand: 'UserId' }) | null
    >()
  })

  it('builds an object from properties, honouring required vs optional', () => {
    type Result = FromSchema<{
      type: 'object'
      properties: { id: { type: 'integer' }; name: { type: 'string' } }
      required: ['id']
    }>
    expectTypeOf<Result>().toEqualTypeOf<{ id: number; name?: string }>()
  })

  it('treats a required name with no properties entry as a required unknown', () => {
    type Result = FromSchema<{
      type: 'object'
      properties: { id: { type: 'integer' } }
      required: ['id', 'token']
    }>
    expectTypeOf<Result>().toEqualTypeOf<{ id: number; token: unknown }>()
  })

  it('adds an open index signature for additionalProperties: true', () => {
    type Result = FromSchema<{
      type: 'object'
      properties: { id: { type: 'integer' } }
      required: ['id']
      additionalProperties: true
    }>
    expectTypeOf<Result['id']>().toEqualTypeOf<number>()
    expectTypeOf<Result['anythingElse']>().toEqualTypeOf<unknown>()
  })

  it('keeps the shape exact for additionalProperties: false', () => {
    type Result = FromSchema<{
      type: 'object'
      properties: { id: { type: 'integer' } }
      required: ['id']
      additionalProperties: false
    }>
    expectTypeOf<Result>().toEqualTypeOf<{ id: number }>()
  })

  it('types extra members from an additionalProperties schema', () => {
    type Result = FromSchema<{
      type: 'object'
      properties: { id: { type: 'integer' } }
      required: ['id']
      additionalProperties: { type: 'string' }
    }>
    expectTypeOf<Result['id']>().toEqualTypeOf<number>()
    expectTypeOf<Result['label']>().toEqualTypeOf<string>()
  })

  it('types members from patternProperties', () => {
    type Result = FromSchema<{ type: 'object'; patternProperties: { '^x': { type: 'number' } } }>
    expectTypeOf<Result['x1']>().toEqualTypeOf<number>()
  })

  it('infers a bare object as Record<string, unknown>', () => {
    expectTypeOf<FromSchema<{ type: 'object' }>>().toEqualTypeOf<Record<string, unknown>>()
  })

  it('nests object shapes recursively', () => {
    type Result = FromSchema<{
      type: 'object'
      properties: {
        user: {
          type: 'object'
          properties: { name: { type: 'string' } }
          required: ['name']
        }
      }
      required: ['user']
    }>
    expectTypeOf<Result>().toEqualTypeOf<{ user: { name: string } }>()
  })

  it('maps a list of items to an array', () => {
    expectTypeOf<FromSchema<{ type: 'array'; items: { type: 'string' } }>>().toEqualTypeOf<string[]>()
  })

  it('maps prefixItems to a tuple, with items as an open rest', () => {
    type Result = FromSchema<{ type: 'array'; prefixItems: [{ type: 'string' }, { type: 'number' }] }>
    expectTypeOf<Result>().toEqualTypeOf<[string, number, ...unknown[]]>()
  })

  it('types the rest of a tuple from a trailing items schema', () => {
    type Result = FromSchema<{
      type: 'array'
      prefixItems: [{ type: 'string' }]
      items: { type: 'number' }
    }>
    expectTypeOf<Result>().toEqualTypeOf<[string, ...number[]]>()
  })

  it('seals a tuple when the rest is items: false', () => {
    type Result = FromSchema<{ type: 'array'; prefixItems: [{ type: 'string' }]; items: false }>
    expectTypeOf<Result>().toEqualTypeOf<[string]>()
  })

  it('supports the draft-07 tuple form (items array + additionalItems)', () => {
    type Result = FromSchema<{ type: 'array'; items: [{ type: 'string' }]; additionalItems: { type: 'number' } }>
    expectTypeOf<Result>().toEqualTypeOf<[string, ...number[]]>()
  })

  it('intersects allOf branches', () => {
    type Result = FromSchema<{
      allOf: [
        { type: 'object'; properties: { a: { type: 'string' } }; required: ['a'] },
        { type: 'object'; properties: { b: { type: 'number' } }; required: ['b'] },
      ]
    }>
    expectTypeOf<Result['a']>().toEqualTypeOf<string>()
    expectTypeOf<Result['b']>().toEqualTypeOf<number>()
  })

  it('unions anyOf and oneOf branches', () => {
    expectTypeOf<FromSchema<{ anyOf: [{ type: 'string' }, { type: 'number' }] }>>().toEqualTypeOf<string | number>()
    expectTypeOf<FromSchema<{ oneOf: [{ type: 'string' }, { type: 'boolean' }] }>>().toEqualTypeOf<string | boolean>()
  })

  it('widens a nullable schema with null', () => {
    expectTypeOf<FromSchema<{ type: 'string'; nullable: true }>>().toEqualTypeOf<string | null>()
  })

  it('reads boolean schemas as accept-all and reject-all', () => {
    expectTypeOf<FromSchema<true>>().toEqualTypeOf<unknown>()
    expectTypeOf<FromSchema<false>>().toEqualTypeOf<never>()
  })

  it('infers the validator output type, recoverable via Infer', () => {
    const validateUser = validate({
      type: 'object',
      properties: { id: { type: 'integer' }, name: { type: 'string' } },
      required: ['id'],
    })
    expectTypeOf<Infer<typeof validateUser>>().toEqualTypeOf<{ id: number; name?: string }>()
  })

  it('infers the guard type so a passing check narrows', () => {
    const isPoint = validateGuard({
      type: 'object',
      properties: { x: { type: 'number' }, y: { type: 'number' } },
      required: ['x', 'y'],
    })
    expectTypeOf<Infer<typeof isPoint>>().toEqualTypeOf<{ x: number; y: number }>()

    const value: unknown = { x: 1, y: 2 }
    if (isPoint(value)) {
      // Only type-checks if the guard narrowed `value` to the inferred shape.
      expectTypeOf(value).toEqualTypeOf<{ x: number; y: number }>()
    }
  })

  it('still honours an explicit guard type argument', () => {
    type Point = { x: number; y: number }
    const isPoint = validateGuard<Point>({
      type: 'object',
      properties: { x: { type: 'number' }, y: { type: 'number' } },
      required: ['x', 'y'],
    })
    expectTypeOf<Infer<typeof isPoint>>().toEqualTypeOf<Point>()
  })

  it('drops the narrowing for a typeless schema whose keywords only describe the object case', () => {
    // `{ properties: … }` ignores a non-object, so the interpreter accepts `42` —
    // and it does, at runtime, today. `FromSchema` describes only the object case,
    // so `input is { a?: string }` would be a lie. The verdict stays; the claim goes.
    const check = validateGuard({ properties: { a: { type: 'string' } } })
    expect(check(42)).toBe(true)

    const value: unknown = { a: 'x' }
    if (check(value)) {
      // Deliberately *not* narrowed — this is the whole point of the change.
      expectTypeOf(value).toEqualTypeOf<unknown>()
    }
    // The inferred shape is still recoverable, it is just not asserted.
    expectTypeOf<Infer<typeof check>>().toEqualTypeOf<{ a?: string }>()
  })

  it('drops the narrowing for the other implicit-shape keywords too', () => {
    const required = validateGuard({ required: ['a'] })
    const items = validateGuard({ items: { type: 'string' } })
    expectTypeOf(required).toEqualTypeOf<Check<{ [key: string]: unknown }>>()
    expectTypeOf(items).toEqualTypeOf<Check<string[]>>()
    // The runtime verdict is unchanged: object/array keywords ignore other types.
    expect(required(42)).toBe(true)
    expect(items('nope')).toBe(true)
  })

  it('keeps the predicate wherever the schema pins the instance to one type', () => {
    // The common case, and the one that must never regress.
    expectTypeOf(validateGuard({ type: 'object', properties: { a: { type: 'string' } } })).toEqualTypeOf<
      Guard<{ a?: string }>
    >()
    expectTypeOf(validateGuard({ type: 'string' })).toEqualTypeOf<Guard<string>>()
    expectTypeOf(validateGuard({ enum: ['a', 'b'] })).toEqualTypeOf<Guard<'a' | 'b'>>()
    expectTypeOf(validateGuard({ const: 42 })).toEqualTypeOf<Guard<42>>()
    // A `$ref` hands the verdict to the referenced schema, which answers for itself.
    expectTypeOf(validateGuard({ $ref: '#/$defs/x' })).toEqualTypeOf<Guard<unknown>>()
  })

  it('judges a combinator by its branches', () => {
    // Every branch pins a type, so the union describes everything accepted.
    expectTypeOf(validateGuard({ anyOf: [{ type: 'string' }, { type: 'number' }] })).toEqualTypeOf<
      Guard<string | number>
    >()
    // One branch carries only applicator keywords, so the union does not.
    expectTypeOf(
      validateGuard({ anyOf: [{ type: 'string' }, { properties: { a: { type: 'number' } } }] }),
    ).toEqualTypeOf<Check<string | { a?: number }>>()
  })

  it('keeps the predicate when the schema type is not a literal', () => {
    // A schema value handed over at runtime cannot be judged either way, and the
    // useful default is the one every caller already depends on.
    const schema: unknown = { properties: { a: { type: 'string' } } }
    expectTypeOf(validateGuard(schema)).toEqualTypeOf<Guard<unknown>>()
  })

  it('still honours an explicit type argument for an implicit-shape schema', () => {
    // Asking for the narrowing deliberately is always taken at face value — the
    // caller has said they know the instance is an object.
    type Shape = { a?: string }
    const isShape = validateGuard<Shape>({ properties: { a: { type: 'string' } } })

    const value: unknown = { a: 'x' }
    if (isShape(value)) {
      expectTypeOf(value).toEqualTypeOf<Shape>()
    }
  })
})
