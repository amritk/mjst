import { describe, expect, it } from 'vitest'

import { loadComponentSchemas } from '../../../fixtures/openapi/load-fixtures'
import { validate } from './validate'
import { validateGuard } from './validate-guard'

/**
 * Drives the runtime interpreter over every `components.schemas` entry in the
 * vendored, real-world OpenAPI corpus (see `fixtures/openapi/README.md`). These
 * are hundreds of hand-written schemas we don't control — discriminated unions,
 * deep `allOf`/`oneOf` composition, recursive shapes, formats, and OpenAPI's
 * `nullable`. Two invariants must hold for each one:
 *
 *  1. Preparing and running a validator never throws.
 *  2. The boolean guard and the error-collecting validator always agree on a
 *     verdict — the core contract the differential suite pins down on synthetic
 *     input, asserted here against real input.
 */
const corpus = loadComponentSchemas()

/** A spread of values that probe the common acceptance/rejection paths. */
const baseProbes: unknown[] = [undefined, null, true, 0, 1, -1, 'x', '', [], {}, [1, 2], { a: 1 }]

/** Pull likely-valid sample values out of a schema (example/default/const/enum). */
const sampleValues = (schema: unknown): unknown[] => {
  if (schema === null || typeof schema !== 'object') return []
  const s = schema as Record<string, unknown>
  const values: unknown[] = []
  if ('example' in s) values.push(s['example'])
  if ('default' in s) values.push(s['default'])
  if ('const' in s) values.push(s['const'])
  if (Array.isArray(s['enum'])) values.push(...s['enum'])
  return values
}

describe('openapi-fixtures', () => {
  it('loads a non-trivial corpus of component schemas', () => {
    const total = corpus.reduce((sum, group) => sum + group.schemas.length, 0)
    expect(total).toBeGreaterThan(50)
  })

  for (const { fixture, schemas } of corpus) {
    it(`guard and validator agree for every schema in ${fixture}`, () => {
      for (const { name, schema } of schemas) {
        const check = validate(schema)
        const guard = validateGuard(schema)
        for (const value of [...baseProbes, ...sampleValues(schema)]) {
          const valid = check(value) === true
          // The guard is a zero-allocation short-circuit of the same logic; it
          // must reach the identical verdict on every value.
          expect(guard(value), `${name} disagreed on ${JSON.stringify(value) ?? 'undefined'}`).toBe(valid)
        }
      }
    })
  }
})
