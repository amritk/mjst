import type { IFunctionResult, JsonPath, RulesetFunction } from '../../../core'
import { isObject, OPERATION_METHODS } from './helpers'

/** Walks `path` into `root`, returning the nested value or undefined. */
const getIn = (root: unknown, path: string[]): unknown => {
  let current: unknown = root
  for (const key of path) {
    if (!isObject(current)) return undefined
    current = current[key]
  }
  return current
}

/** Validates that every referenced security scheme is defined. */
export const oasOpSecurityDefined: RulesetFunction<Record<string, unknown>, { schemesPath: string[] }> = (
  root,
  options,
  context,
) => {
  if (!isObject(root)) return []
  const schemes = getIn(root, options?.schemesPath ?? [])
  const defined = new Set(isObject(schemes) ? Object.keys(schemes) : [])
  const results: IFunctionResult[] = []

  const check = (security: unknown, path: JsonPath): void => {
    if (!Array.isArray(security)) return
    security.forEach((requirement, index) => {
      if (!isObject(requirement)) return
      for (const name of Object.keys(requirement)) {
        if (!defined.has(name)) {
          results.push({ message: `Security scheme "${name}" is not defined`, path: [...path, index, name] })
        }
      }
    })
  }

  check(root['security'], [...context.path, 'security'])
  const paths = isObject(root['paths']) ? root['paths'] : {}
  for (const [path, item] of Object.entries(paths)) {
    if (!isObject(item)) continue
    for (const [method, operation] of Object.entries(item)) {
      if (OPERATION_METHODS.has(method) && isObject(operation)) {
        check(operation['security'], [...context.path, 'paths', path, method, 'security'])
      }
    }
  }
  return results
}
