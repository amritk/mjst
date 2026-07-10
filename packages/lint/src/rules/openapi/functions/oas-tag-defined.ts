import type { IFunctionResult, RulesetFunction } from '../../../core'
import { isObject } from './helpers'

/** Ensures each operation tag is declared in the global `tags` list. */
export const oasTagDefined: RulesetFunction = (input, _options, context) => {
  const root = context.document.data
  if (!isObject(root) || !isObject(input)) return []
  const globalTags = new Set(
    (Array.isArray(root['tags']) ? root['tags'] : [])
      .map((tag) => (isObject(tag) ? tag['name'] : undefined))
      .filter((name): name is string => typeof name === 'string'),
  )
  const tags = Array.isArray(input['tags']) ? input['tags'] : []
  const results: IFunctionResult[] = []
  tags.forEach((tag, index) => {
    if (typeof tag === 'string' && !globalTags.has(tag)) {
      results.push({
        message: `Operation tag "${tag}" is not defined in the global tags`,
        path: [...context.path, 'tags', index],
      })
    }
  })
  return results
}
