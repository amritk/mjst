import type { RulesetFunction } from '../core'

/** Flags a value that is not truthy. */
export const truthy: RulesetFunction = (input) => {
  if (!input) return [{ message: 'The value must be truthy' }]
  return []
}
