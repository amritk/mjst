import type { RulesetFunction } from '../../../core/types'
import { isObject } from './helpers'

// A success response is any 2xx/3xx status code, or a `2XX`/`3XX` wildcard (3.x).
// `default` is intentionally NOT counted — it can carry any status, including an
// error, so it does not prove the operation has a success response (this matches
// Spectral, which counts only codes in the [200, 400) range plus the wildcards).
const SUCCESS_CODE = /^[23](\d\d|XX)$/

/** Ensures every operation declares at least one 2xx or 3xx response. */
export const oasOpSuccessResponse: RulesetFunction = (responses) => {
  if (!isObject(responses)) return []
  const hasSuccess = Object.keys(responses).some((code) => SUCCESS_CODE.test(code))
  if (!hasSuccess) {
    return [{ message: 'Operation must define at least one 2xx or 3xx response' }]
  }
  return []
}
