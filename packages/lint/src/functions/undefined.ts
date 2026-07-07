import type { RulesetFunction } from '../core'

/**
 * Flags a value that is defined. Exported as `undefinedFn` because `undefined`
 * is a reserved identifier; it is registered under the name `undefined`.
 */
export const undefinedFn: RulesetFunction = (input) => {
  if (input !== undefined) return [{ message: 'The value must be undefined' }]
  return []
}
