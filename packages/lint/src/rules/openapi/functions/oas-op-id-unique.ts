import type { IFunctionResult, RulesetFunction } from '../../../core'
import { isObject } from './helpers'

/** Ensures `operationId` values are unique across the document. */
export const oasOpIdUnique: RulesetFunction = (paths, _options, context) => {
  if (!isObject(paths)) return []
  const seen = new Set<string>()
  const results: IFunctionResult[] = []
  for (const [path, item] of Object.entries(paths)) {
    if (!isObject(item)) continue
    for (const [method, operation] of Object.entries(item)) {
      if (!isObject(operation)) continue
      const id = operation['operationId']
      if (typeof id !== 'string') continue
      if (seen.has(id)) {
        results.push({
          message: `operationId "${id}" must be unique`,
          path: [...context.path, path, method, 'operationId'],
        })
      }
      seen.add(id)
    }
  }
  return results
}
