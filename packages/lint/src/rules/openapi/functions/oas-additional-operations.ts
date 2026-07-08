import type { IFunctionResult, RulesetFunction } from '../../../core'
import { HTTP_METHODS, isObject } from './helpers'

// HTTP methods that have a dedicated fixed field on the Path Item Object. In
// OpenAPI 3.2 `query` joined the original eight, and these MUST NOT be redefined
// inside the new `additionalOperations` map (which is for non-standard methods).
const FIXED_PATH_ITEM_METHODS = new Set([...HTTP_METHODS, 'query'])

/**
 * Flags standard HTTP methods inside an OpenAPI 3.2 `additionalOperations` map.
 * The spec reserves that map for methods without a dedicated fixed field, so a
 * standard method key (sent uppercase, e.g. `POST`) belongs in the lowercase
 * fixed field (`post`) instead.
 */
export const oasAdditionalOperations: RulesetFunction = (input, _options, context) => {
  if (!isObject(input)) return []
  const results: IFunctionResult[] = []
  for (const method of Object.keys(input)) {
    if (FIXED_PATH_ITEM_METHODS.has(method.toLowerCase())) {
      results.push({
        message: `"additionalOperations" must not redefine the standard method "${method}"; use the "${method.toLowerCase()}" field instead`,
        path: [...context.path, method],
      })
    }
  }
  return results
}
