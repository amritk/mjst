import type { RulesetFunction } from '../core/types'

/** Options for {@link enumeration}. */
export type IEnumerationOptions = {
  values: unknown[]
}

/**
 * True for the primitive kinds Spectral's input schema accepts
 * (`string`, `number`, `null`, `boolean`). Objects and arrays are excluded so
 * they cannot slip through the reference-equality `includes` check below and be
 * flagged against a list they could never be `===` to.
 */
const isPrimitive = (value: unknown): boolean =>
  value === null || (typeof value !== 'object' && typeof value !== 'function')

/** Flags a value that is not one of the allowed `values`. */
export const enumeration: RulesetFunction<unknown, IEnumerationOptions> = (input, options) => {
  const values = options?.values
  // Without a valid list of allowed values there is nothing to compare against.
  // Spectral requires `values` in its option schema and no-ops when it is
  // missing, so skip rather than flag everything against an empty allow-list.
  if (!Array.isArray(values)) return []
  // Spectral's input schema only lets primitives reach this function. `includes`
  // uses reference equality, so a non-primitive would always be reported as
  // "not allowed"; match Spectral by skipping objects and arrays entirely.
  if (!isPrimitive(input)) return []
  if (!values.includes(input)) {
    return [
      { message: `The value must be one of the allowed values: ${values.map((v) => JSON.stringify(v)).join(', ')}` },
    ]
  }
  return []
}
