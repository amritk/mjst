import type { IFunctionResult, RulesetFunction } from '../../../core'
import { isObject } from './helpers'

/**
 * Validates an operation's `parameters` array, mirroring Spectral's `oasOpParams`:
 * flags duplicate `name`+`in` combinations, and — for OpenAPI 2.0, where the body
 * is a parameter — flags more than one `in: body` parameter (even with different
 * names) as well as mixing `in: body` with `in: formData`. `$ref` entries are
 * skipped because their real `name`/`in` is only known after resolution.
 */
export const oasOpParams: RulesetFunction = (params, _options, context) => {
  if (!Array.isArray(params)) return []
  const results: IFunctionResult[] = []
  const seen = new Set<string>()
  const bodyIndices: number[] = []
  const formDataIndices: number[] = []

  params.forEach((param, index) => {
    if (!isObject(param) || '$ref' in param) return
    if (param['name'] !== undefined && param['in'] !== undefined) {
      const key = `${String(param['in'])}:${String(param['name'])}`
      if (seen.has(key)) {
        results.push({
          message: `Duplicate parameter "${String(param['name'])}" in "${String(param['in'])}"`,
          path: [...context.path, index],
        })
      }
      seen.add(key)
    }
    if (param['in'] === 'body') bodyIndices.push(index)
    else if (param['in'] === 'formData') formDataIndices.push(index)
  })

  // OAS2 allows at most one body parameter, and body and formData are mutually
  // exclusive within a single operation.
  if (bodyIndices.length > 0 && formDataIndices.length > 0) {
    results.push({ message: 'Operation must not have both "in:body" and "in:formData" parameters' })
  }
  for (let i = 1; i < bodyIndices.length; i++) {
    results.push({
      message: 'Operation must not have more than a single instance of the "in:body" parameter',
      path: [...context.path, bodyIndices[i] as number],
    })
  }

  return results
}
