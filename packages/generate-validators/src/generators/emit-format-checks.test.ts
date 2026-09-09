import { validate } from '@amritk/runtime-validators'
import { describe, expect, it } from 'vitest'

import { loadSuiteFormatCases } from '../../../../fixtures/json-schema-test-suite/load-suite'
import { buildValidatorSchema } from './build-schema'
import { FORMAT_FRAGMENTS } from './emit-format-checks'
import { linkGenerated } from './link-generated.test-utils'

/**
 * The generated `format` checks are a *second implementation* of the ones in
 * `@amritk/runtime-validators`, because generated validators are dependency-free
 * and cannot import them. Two implementations of one rule is exactly the
 * situation that drifts, so the two are run over the official suite's whole
 * optional/format corpus and required to agree on every case.
 *
 * That is also what makes the feature worth having: a `format` a generated
 * validator accepts and the interpreter rejects is the silent divergence this
 * closes, and it would be no better if the generated half were merely *present*
 * rather than right.
 */
const ALL_FORMATS = Object.keys(FORMAT_FRAGMENTS)

/** Builds a validator + guard pair for one schema, with the given formats enforced. */
const build = async (schema: unknown, formats: readonly string[] | 'all') => {
  const files = await buildValidatorSchema(schema as never, 'Doc', '', undefined, undefined, formats)
  return {
    files,
    validate: linkGenerated<(input: unknown) => unknown>(files, 'index', 'validateDoc'),
    guard: linkGenerated<(input: unknown) => boolean>(files, 'index', 'isDoc'),
  }
}

describe('emit-format-checks', () => {
  it('emits nothing at all when no formats are enforced', async () => {
    // The default has to stay exactly what it was: `format` is an annotation, and
    // a build that did not ask for formats gets no extra file and no extra check.
    const files = await buildValidatorSchema({ type: 'string', format: 'uuid' } as never, 'Doc')
    expect(files.map((file) => file.filename)).not.toContain('formats.ts')
    expect(files.find((file) => file.filename === 'doc.ts')?.content).not.toMatch(/isFormat/)
  })

  it('emits only the formats the schema actually names', async () => {
    // A schema declaring one `uuid` gets one regex, not the whole table.
    const { files } = await build({ type: 'string', format: 'uuid' }, 'all')
    const module_ = files.find((file) => file.filename === 'formats.ts')?.content ?? ''
    expect(module_).toMatch(/isFormatUuid/)
    expect(module_).not.toMatch(/isFormatEmail/)
  })

  it('checks the format in both validateDoc and isDoc', async () => {
    // The flat guard and the validator must reach the same verdict — a guard that
    // disagrees is worse than no guard.
    const { validate: validateDoc, guard } = await build({ type: 'string', format: 'date' }, ['date'])
    expect(validateDoc('2020-02-29')).toBe(true)
    expect(guard('2020-02-29')).toBe(true)
    expect(validateDoc('2020-02-30')).not.toBe(true)
    expect(guard('2020-02-30')).toBe(false)
  })

  it('reports a format failure with the same error the interpreter gives', async () => {
    const { validate: validateDoc } = await build({ type: 'string', format: 'uuid' }, ['uuid'])
    expect(validateDoc('not-a-uuid')).toEqual({
      valid: false,
      errors: [{ message: 'must match format "uuid"', path: '', keyword: 'format', params: { format: 'uuid' } }],
    })
  })

  it('checks a numeric format against the number, not the string', async () => {
    const { validate: validateDoc, guard } = await build({ type: 'integer', format: 'int32' }, ['int32'])
    expect(validateDoc(2_147_483_647)).toBe(true)
    expect(validateDoc(2_147_483_648)).not.toBe(true)
    expect(guard(2_147_483_648)).toBe(false)
  })

  it('leaves a format alone when the instance is of another type', async () => {
    // A format asserts about one JSON type and is silent about every other, so a
    // type-less node with `format: 'int32'` still accepts a string.
    const { validate: validateDoc } = await build({ format: 'int32' }, ['int32'])
    expect(validateDoc('not a number')).toBe(true)
    expect(validateDoc(1.5)).not.toBe(true)
  })

  it('enforces only the formats it was given', async () => {
    const { validate: validateDoc } = await build(
      { type: 'object', properties: { a: { type: 'string', format: 'date' }, b: { type: 'string', format: 'uuid' } } },
      ['uuid'],
    )
    expect(validateDoc({ a: 'not-a-date', b: '2eb8aa08-aa98-11ea-b4aa-73b441d16380' })).toBe(true)
    expect(validateDoc({ a: 'not-a-date', b: 'nope' })).not.toBe(true)
  })

  it('agrees with the interpreter across the whole optional/format corpus', async () => {
    // The drift guard. One generated validator per format, run over every case
    // the suite has for it, against the interpreter's verdict for the same
    // schema and value.
    const byFormat = new Map<string, { data: unknown; valid: boolean }[]>()
    for (const testCase of loadSuiteFormatCases()) {
      const format = (testCase.schema as { format?: unknown })?.format
      if (typeof format !== 'string' || !ALL_FORMATS.includes(format)) continue
      const cases = byFormat.get(format) ?? []
      cases.push({ data: testCase.data, valid: testCase.valid })
      byFormat.set(format, cases)
    }
    expect(byFormat.size).toBeGreaterThan(15)

    const divergences: string[] = []
    let checked = 0
    for (const [format, cases] of byFormat) {
      const { validate: validateDoc } = await build({ format }, [format])
      const interpret = validate({ format }, { formats: [format] })
      for (const { data } of cases) {
        checked++
        const generated = validateDoc(data) === true
        const interpreted = interpret(data) === true
        if (generated !== interpreted) {
          divergences.push(`${format} ${JSON.stringify(data)}: generated=${generated} interpreted=${interpreted}`)
        }
      }
    }

    expect(checked).toBeGreaterThan(700)
    expect(divergences).toEqual([])
  })
})
