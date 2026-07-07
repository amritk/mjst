import type { RulesetFunction } from '../core'

/** Flags a value that is not one of the allowed `values`. */
export const enumeration: RulesetFunction<unknown, { values: unknown[] }> = (input, options) => {
  const values = options?.values ?? []
  if (!values.includes(input)) {
    return [
      { message: `The value must be one of the allowed values: ${values.map((v) => JSON.stringify(v)).join(', ')}` },
    ]
  }
  return []
}
