import type { IFunctionResult, RulesetFunction } from '../../../core'
import { isObject } from './helpers'

/**
 * Validates the OpenAPI 3.2 Tag Object `parent` hierarchy: every `parent` must
 * name a tag that exists in the top-level `tags` list, a tag must not be its own
 * parent, and the parent chain must not form a cycle.
 */
export const oasTagParentDefined: RulesetFunction = (tags, _options, context) => {
  if (!Array.isArray(tags)) return []
  const byName = new Map<string, Record<string, unknown>>()
  for (const tag of tags) {
    if (isObject(tag) && typeof tag['name'] === 'string') byName.set(tag['name'], tag)
  }
  const results: IFunctionResult[] = []
  tags.forEach((tag, index) => {
    if (!isObject(tag) || typeof tag['parent'] !== 'string') return
    const parent = tag['parent']
    const name = typeof tag['name'] === 'string' ? tag['name'] : undefined
    if (!byName.has(parent)) {
      results.push({
        message: `Tag parent "${parent}" is not defined in the global tags`,
        path: [...context.path, index, 'parent'],
      })
      return
    }
    // Walk the parent chain from this tag; a repeat means a cycle (incl. self-parent).
    const visited = new Set<string>(name ? [name] : [])
    let current: string | undefined = parent
    while (current !== undefined) {
      if (visited.has(current)) {
        results.push({
          message: `Tag "${name ?? '(unnamed)'}" has a circular parent reference via "${current}"`,
          path: [...context.path, index, 'parent'],
        })
        break
      }
      visited.add(current)
      const next: unknown = byName.get(current)?.['parent']
      current = typeof next === 'string' ? next : undefined
    }
  })
  return results
}
