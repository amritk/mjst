import type { RulesetFunction } from '../core/types'

/** Flags a value that is `undefined`. */
export const defined: RulesetFunction = (input) => {
  if (input === undefined) return [{ message: 'The value must be defined' }]
  return []
}
