import type { IFunctionResult, RulesetFunction } from '../../../core'
import { isObject } from './helpers'

/** Flags objects that mix `$ref` with sibling keys (which are ignored per spec). */
export const refSiblings: RulesetFunction = (input, _options, context) => {
  if (!isObject(input) || !('$ref' in input)) return []
  const results: IFunctionResult[] = []
  for (const key of Object.keys(input)) {
    if (key !== '$ref') {
      results.push({ message: `$ref must not be placed next to "${key}"`, path: [...context.path, key] })
    }
  }
  return results
}
