import type { IFunctionResult, RulesetFunction } from '../../../core'
import { isObject } from './helpers'

/** Flags duplicate global tag names. */
export const oasTagsUnique: RulesetFunction = (tags, _options, context) => {
  if (!Array.isArray(tags)) return []
  const seen = new Set<string>()
  const results: IFunctionResult[] = []
  tags.forEach((tag, index) => {
    if (!isObject(tag) || typeof tag['name'] !== 'string') return
    if (seen.has(tag['name'])) {
      results.push({ message: `Duplicate tag name "${tag['name']}"`, path: [...context.path, index, 'name'] })
    }
    seen.add(tag['name'])
  })
  return results
}
