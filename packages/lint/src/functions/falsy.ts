import type { RulesetFunction } from '../core'

/** Flags a value that is not falsy. */
export const falsy: RulesetFunction = (input) => {
  if (input) return [{ message: 'The value must be falsy' }]
  return []
}
