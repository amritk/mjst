import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'

import { buildValidatorSchema } from './build-schema'
import { linkGenerated } from './link-generated.test-utils'

/**
 * What `repairX` promises, exercised against the linked output rather than the
 * emitted text — a repair that reads correctly and links wrong is still broken.
 *
 * The invariant worth stating once, because most of these are instances of it:
 * whatever `repairX` hands back with `valid: true` is a value `validateX`
 * accepts. A repair that leaves the document still invalid is not a repair, it
 * is a silently substituted wrong answer, which is the one outcome worse than
 * reporting the error.
 */

type ValidationError = { message: string; path: string; keyword: string; params: Record<string, unknown> }
type RepairResult = {
  valid: boolean
  value: unknown
  repairs: ValidationError[]
  errors?: ValidationError[]
}
type Repair = (input: unknown) => RepairResult
type Validate = (input: unknown) => true | { valid: false; errors: ValidationError[] }

/** Builds a repairing validator set and links out both halves of it. */
const build = async (schema: JSONSchema): Promise<{ repair: Repair; validate: Validate }> => {
  const files = await buildValidatorSchema(schema, 'Root', '', undefined, 'count-keys', undefined, false, false, true)
  return {
    repair: linkGenerated<Repair>(files, 'index', 'repairRoot'),
    validate: linkGenerated<Validate>(files, 'index', 'validateRoot'),
  }
}

const objectSchema = (properties: Record<string, JSONSchema>, required: string[]): JSONSchema => ({
  type: 'object',
  properties,
  required,
})

describe('repairX', () => {
  it('leaves a document that needs nothing alone, and reports no repairs', async () => {
    const { repair } = await build(objectSchema({ n: { type: 'integer', minimum: 0 } }, ['n']))
    const input = { n: 5 }

    const result = repair(input)

    expect(result).toEqual({ valid: true, value: { n: 5 }, repairs: [] })
    // Nothing moved, so nothing was copied either — the input comes back itself.
    expect(result.value).toBe(input)
  })

  it('coerces before it repairs, so a wrong type is not reported as a repair', async () => {
    const { repair } = await build(objectSchema({ n: { type: 'integer' }, b: { type: 'boolean' } }, ['n']))

    const result = repair({ n: '5', b: 'true' })

    expect(result.valid).toBe(true)
    expect(result.value).toEqual({ n: 5, b: true })
    // A value merely written in the wrong type was always the right value.
    expect(result.repairs).toEqual([])
  })

  it('fills a missing required property from the schema default', async () => {
    const { repair } = await build(objectSchema({ n: { type: 'integer', default: 3 } }, ['n']))

    const result = repair({})

    expect(result.valid).toBe(true)
    expect(result.value).toEqual({ n: 3 })
    expect(result.repairs).toHaveLength(1)
    expect(result.repairs[0]).toMatchObject({ keyword: 'required', params: { missingProperty: 'n' } })
  })

  it('repairs a bounded number to a value inside its own bounds', async () => {
    const { repair, validate } = await build(objectSchema({ n: { type: 'integer', minimum: 5, maximum: 10 } }, ['n']))

    const result = repair({ n: 99 })

    expect(result.valid).toBe(true)
    expect(result.repairs[0]).toMatchObject({ keyword: 'maximum', path: '/n' })
    expect(validate(result.value)).toBe(true)
  })

  it('creates a missing nested object and then fills its own required properties', async () => {
    const { repair, validate } = await build(
      objectSchema({ inner: objectSchema({ a: { type: 'string', minLength: 2 } }, ['a']) }, ['inner']),
    )

    const result = repair({})

    expect(result.valid).toBe(true)
    expect(validate(result.value)).toBe(true)
    expect(result.value).toEqual({ inner: { a: 'xx' } })
  })

  it('pads a short array to minItems in one repair', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { xs: { type: 'array', minItems: 3, items: { type: 'integer', minimum: 1 } } },
      required: ['xs'],
    }
    const { repair, validate } = await build(schema)

    const result = repair({ xs: [7] })

    expect(result.valid).toBe(true)
    expect(result.value).toEqual({ xs: [7, 1, 1] })
    expect(validate(result.value)).toBe(true)
    // One error, one repair — padding is a single operation, not one per element.
    expect(result.repairs).toHaveLength(1)
    expect(result.repairs[0]).toMatchObject({ keyword: 'minItems', path: '/xs' })
  })

  it('repairs one bad element without disturbing its neighbours', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { xs: { type: 'array', items: { type: 'integer', minimum: 1 } } },
      required: ['xs'],
    }
    const { repair } = await build(schema)

    const result = repair({ xs: [4, 0, 6] })

    expect(result.value).toEqual({ xs: [4, 1, 6] })
    expect(result.repairs[0]).toMatchObject({ keyword: 'minimum', path: '/xs/1' })
  })

  it('repairs a root that is not even the right kind of value', async () => {
    const { repair, validate } = await build(objectSchema({ n: { type: 'integer', default: 3 } }, ['n']))

    const result = repair('nope')

    expect(result.valid).toBe(true)
    expect(result.value).toEqual({ n: 3 })
    expect(validate(result.value)).toBe(true)
    expect(result.repairs[0]).toMatchObject({ keyword: 'type', path: '' })
  })

  it('reports the errors it could not repair, alongside the repairs it made', async () => {
    // `blank` has no type and no default, so the schema offers nothing to repair
    // its absence toward; `n` does.
    const { repair } = await build(objectSchema({ blank: {}, n: { type: 'integer', default: 3 } }, ['blank', 'n']))

    const result = repair({})

    expect(result.valid).toBe(false)
    expect(result.repairs).toHaveLength(1)
    expect(result.repairs[0]).toMatchObject({ params: { missingProperty: 'n' } })
    expect(result.errors?.[0]).toMatchObject({ keyword: 'required', params: { missingProperty: 'blank' } })
  })

  it('reports repairs that are the validator errors themselves, verbatim', async () => {
    const schema = objectSchema({ n: { type: 'integer', minimum: 5 } }, ['n'])
    const { repair, validate } = await build(schema)
    const input = { n: 1 }

    const rejected = validate(input)
    const result = repair(input)

    // The point of driving repair from the validator: a caller logging a repair
    // logs the same path, keyword and params it would have been rejected with.
    expect(rejected).not.toBe(true)
    expect(result.repairs).toEqual(rejected === true ? [] : rejected.errors)
  })

  it('never modifies the input', async () => {
    const { repair } = await build(
      objectSchema({ inner: objectSchema({ a: { type: 'integer', minimum: 5 } }, ['a']) }, ['inner']),
    )
    const input = { inner: { a: 1 } }

    const result = repair(input)

    expect(input).toEqual({ inner: { a: 1 } })
    expect(result.value).toEqual({ inner: { a: 5 } })
  })

  it('shares everything the repair did not touch', async () => {
    const { repair } = await build(
      objectSchema({ keep: { type: 'object' }, n: { type: 'integer', minimum: 5 } }, ['n']),
    )
    const keep = { big: 'untouched' }

    const result = repair({ keep, n: 1 })

    // Copying only along the repaired path is what keeps repairing one field of a
    // large document from cloning the whole thing.
    expect((result.value as { keep: unknown }).keep).toBe(keep)
  })

  it('repairs across a $ref into another generated file', async () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { inner: { $ref: '#/$defs/inner' } },
      required: ['inner'],
      $defs: { inner: objectSchema({ a: { type: 'integer', minimum: 5 } }, ['a']) },
    }
    const { repair, validate } = await build(schema)

    const result = repair({ inner: { a: 1 } })

    expect(result.valid).toBe(true)
    expect(result.value).toEqual({ inner: { a: 5 } })
    expect(validate(result.value)).toBe(true)
  })

  it('terminates rather than spinning when the schema cannot satisfy itself', async () => {
    // `minLength` above `maxLength` is unsatisfiable, so whatever the fallback
    // table offers will fail again. The loop must refuse the second attempt and
    // report, not keep trying.
    const { repair } = await build(objectSchema({ s: { type: 'string', minLength: 5, maxLength: 2 } }, ['s']))

    const result = repair({})

    expect(result.valid).toBe(false)
    expect(result.errors?.length).toBeGreaterThan(0)
  })

  it('is off by default, so a plain build emits no repairX', async () => {
    const files = await buildValidatorSchema(objectSchema({ n: { type: 'integer' } }, ['n']), 'Root')

    expect(files.every((file) => !file.content.includes('repairRoot'))).toBe(true)
  })
})
