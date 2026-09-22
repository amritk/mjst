import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { BENCH_CASES } from './schemas.ts'

/**
 * One head-to-head case for the coercion benchmark: a schema both mjst
 * generators consume, and the three input classes that separate them.
 *
 * The schemas are the validators benchmark's own — single-sourced from
 * {@link BENCH_CASES} rather than copied, so the coercion numbers stay
 * comparable to the validate-only numbers next to them and a change to a shape
 * cannot update one table and leave the other stale.
 */
export type CoerceCase = {
  name: string
  typeName: string
  schema: JSONSchema
  /**
   * Input that already matches the schema. The production hot path: a JSON body
   * whose types arrived intact, where the only honest measurement is how cheaply
   * each engine can find nothing to do.
   */
  clean: unknown
  /**
   * The same document with every number and boolean written as a string — a YAML
   * config, a query string, a form post. This is the workload coercion exists
   * for, and the one place the two engines can be asked to produce the same
   * answer: coercing it must land back on {@link CoerceCase.clean}.
   */
  coercible: unknown
  /**
   * Input no coercion can make valid. The two engines part company here by
   * design, so this column times two different contracts rather than one:
   * the parser repairs toward defaults and returns a value, the validator
   * reports errors. Both are real production paths (a tolerant config loader,
   * a rejecting API endpoint), so both are worth a number.
   */
  unrepairable: unknown
}

/**
 * Rewrites every number and boolean in `value` as the string a text format would
 * have carried it as, leaving strings, nulls and structure alone.
 *
 * Deriving the coercible sample from the valid one, rather than writing it out,
 * is what makes the round-trip assertion in the worker meaningful: the expected
 * output is not a second hand-written literal that could drift from the input,
 * it is the very document this was built from.
 */
const stringifyScalars = (value: unknown): unknown => {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(stringifyScalars)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, stringifyScalars(nested)]))
  }
  return value
}

/**
 * The cases worth running head-to-head: a flat object, a nested one with an
 * array of objects, and the moltar shape the rest of the bench suite reports
 * against. The frozen and closed variants in {@link BENCH_CASES} are left out —
 * they exist to separate *validators* on a JavaScriptCore fast path, and neither
 * coercion engine treats them differently.
 */
const CASE_NAMES = ['small (4 fields)', 'order (nested + array)', 'assert-loose'] as const

export const COERCE_CASES: readonly CoerceCase[] = CASE_NAMES.map((name) => {
  const benchCase = BENCH_CASES.find((candidate) => candidate.name === name)
  if (!benchCase) throw new Error(`unknown bench case: ${name}`)
  return {
    name,
    typeName: benchCase.typeName,
    schema: benchCase.schema,
    clean: benchCase.valid,
    coercible: stringifyScalars(benchCase.valid),
    unrepairable: benchCase.invalid,
  }
})
