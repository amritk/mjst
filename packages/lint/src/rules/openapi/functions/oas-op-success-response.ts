import type { RulesetFunction } from '../../../core'
import { isObject } from './helpers'

/** Ensures every operation declares at least one 2xx or 3xx response. */
export const oasOpSuccessResponse: RulesetFunction = (responses) => {
  if (!isObject(responses)) return []
  const hasSuccess = Object.keys(responses).some((code) => /^[23]\d\d$/.test(code) || code === 'default')
  if (!hasSuccess) {
    return [{ message: 'Operation must define at least one 2xx or 3xx response' }]
  }
  return []
}
