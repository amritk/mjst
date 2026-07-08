import type { IFunctionResult, RulesetFunction } from '../../../core'
import { isObject } from './helpers'

/** Flags duplicate `name`+`in` parameter combinations on an operation. */
export const oasOpParams: RulesetFunction = (params, _options, context) => {
  if (!Array.isArray(params)) return []
  const seen = new Set<string>()
  const results: IFunctionResult[] = []
  params.forEach((param, index) => {
    if (!isObject(param) || param['name'] === undefined || param['in'] === undefined) return
    const key = `${String(param['in'])}:${String(param['name'])}`
    if (seen.has(key)) {
      results.push({
        message: `Duplicate parameter "${String(param['name'])}" in "${String(param['in'])}"`,
        path: [...context.path, index],
      })
    }
    seen.add(key)
  })
  return results
}
