import type { IFunctionResult, RulesetFunction } from '../../../core'
import { HTTP_METHODS, isObject } from './helpers'

/** Validates path templating: declared `{params}` must have matching path parameters. */
export const oasPathParam: RulesetFunction = (paths, _options, context) => {
  if (!isObject(paths)) return []
  const results: IFunctionResult[] = []

  for (const [path, item] of Object.entries(paths)) {
    if (!isObject(item)) continue
    const templates = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1] as string)

    const seen = new Set<string>()
    for (const template of templates) {
      if (seen.has(template)) {
        results.push({
          message: `Path "${path}" uses parameter "{${template}}" more than once`,
          path: [...context.path, path],
        })
      }
      seen.add(template)
    }

    const declared = new Set<string>()
    const collect = (params: unknown): void => {
      if (!Array.isArray(params)) return
      for (const param of params) {
        if (isObject(param) && param['in'] === 'path' && typeof param['name'] === 'string') declared.add(param['name'])
      }
    }
    collect(item['parameters'])
    for (const [method, operation] of Object.entries(item)) {
      if (HTTP_METHODS.has(method) && isObject(operation)) collect(operation['parameters'])
    }

    for (const template of seen) {
      if (!declared.has(template)) {
        results.push({
          message: `Path parameter "{${template}}" in "${path}" has no matching path parameter definition`,
          path: [...context.path, path],
        })
      }
    }
  }
  return results
}
