import { assignKey } from '@amritk/helpers/assign-key'

import type { IFunctionResult, JsonPath, RulesetFunction } from '../../../core/types'
import { isObject, OPERATION_METHODS } from './helpers'

// Path template parameters, e.g. `{id}`. Matches Spectral's grammar so matrix
// (`{;id}`), optional (`{id?}`), and explode (`{id*}`) markers are stripped off
// the captured name before comparison.
const PATH_TEMPLATE = /(\{;?\??[a-zA-Z0-9_-]+\*?\})/g

/** A `{name}` → definition-path map for the path parameters collected so far. */
type DefinedParams = Record<string, JsonPath | undefined>

/**
 * Names come from the document, so `__proto__` is one an author may write —
 * and a plain `defined[name] = path` on it sets the map's prototype instead of
 * adding a key, so the name never registers: the duplicate check can never
 * fire for it, the "must be used in path" sweep skips it, and the
 * "must be defined" check reports a parameter that is defined right there.
 */

const namedPathParam = (param: Record<string, unknown>): string | undefined =>
  param['in'] === 'path' && typeof param['name'] === 'string' ? param['name'] : undefined

/**
 * Records a single `in: path` definition, emitting Spectral's `required: true`
 * and duplicate-definition findings. Returns the parameter name when it is the
 * first definition seen (so the caller registers it as usable), else undefined.
 */
const recordPathParam = (
  param: Record<string, unknown>,
  definitionPath: JsonPath,
  seen: DefinedParams,
  results: IFunctionResult[],
): string | undefined => {
  const name = namedPathParam(param)
  if (name === undefined) return undefined
  if (param['required'] !== true) {
    results.push({
      message: `Path parameter "${name}" must have a "required" property that is set to "true"`,
      path: definitionPath,
    })
  }
  // `Object.hasOwn`, not `in`: parameter names come from the document, so a
  // path parameter legitimately named `constructor` matched `Object.prototype`
  // and was reported as a duplicate of itself.
  if (Object.hasOwn(seen, name)) {
    results.push({ message: `Path parameter "${name}" must not be defined multiple times`, path: definitionPath })
    return undefined
  }
  return name
}

/**
 * Validates path templating per operation, mirroring Spectral's `oasPathParam`.
 * For each operation on a path it checks that (a) every `{template}` in the path
 * has a matching `in: path` definition, (b) every `in: path` definition is used
 * in the template, (c) path parameters carry `required: true`, (d) a template is
 * not repeated in the path key, and (e) a parameter is not defined twice. Path
 * Item level parameters are merged with the operation's own parameters. Runs on
 * the resolved document (the rule is `resolved: true`), so `$ref`d parameters are
 * already inlined.
 */
export const oasPathParam: RulesetFunction = (paths, _options, context) => {
  if (!isObject(paths)) return []
  const results: IFunctionResult[] = []

  for (const [path, item] of Object.entries(paths)) {
    if (!isObject(item)) continue

    // (d) Templates declared in the path key, deduplicated (a repeat is an error).
    const templates: string[] = []
    for (const match of path.matchAll(PATH_TEMPLATE)) {
      const name = (match[0] as string).replace(/[{}?*;]/g, '')
      if (templates.includes(name)) {
        results.push({
          message: `Path "${path}" must not use parameter "{${name}}" more than once`,
          path: [...context.path, path],
        })
      } else {
        templates.push(name)
      }
    }

    // Path Item level parameters apply to every operation on the path.
    const topParams: DefinedParams = {}
    if (Array.isArray(item['parameters'])) {
      item['parameters'].forEach((param, index) => {
        if (!isObject(param)) return
        const definitionPath = [...context.path, path, 'parameters', index]
        const name = recordPathParam(param, definitionPath, topParams, results)
        if (name !== undefined) assignKey(topParams, name, definitionPath)
      })
    }

    for (const [method, operation] of Object.entries(item)) {
      if (method === 'parameters' || !OPERATION_METHODS.has(method) || !isObject(operation)) continue
      const operationPath = [...context.path, path, method]

      // Each operation is evaluated against its own params plus the shared path-item ones.
      const operationParams: DefinedParams = {}
      if (Array.isArray(operation['parameters'])) {
        operation['parameters'].forEach((param, index) => {
          if (!isObject(param)) return
          const definitionPath = [...operationPath, 'parameters', index]
          const name = recordPathParam(param, definitionPath, operationParams, results)
          if (name !== undefined) assignKey(operationParams, name, definitionPath)
        })
      }

      // Spread copies own keys as own keys, `__proto__` included, so the
      // guarded writes above survive the merge.
      const defined: DefinedParams = { ...topParams, ...operationParams }
      // (b) Every defined `in: path` parameter must appear in the path template.
      for (const [name, definitionPath] of Object.entries(defined)) {
        if (definitionPath && !templates.includes(name)) {
          results.push({ message: `Parameter "${name}" must be used in path "${path}"`, path: definitionPath })
        }
      }
      // (a) Every `{template}` must have a matching definition on the operation.
      for (const name of templates) {
        // `Object.hasOwn`, as at the duplicate check above: `in` walks the
        // prototype chain, so a `{constructor}` or `{toString}` template read
        // as already defined and its missing parameter went unreported.
        if (!Object.hasOwn(defined, name)) {
          results.push({
            message: `Operation must define path parameter "{${name}}" as expected by path "${path}"`,
            path: operationPath,
          })
        }
      }
    }
  }
  return results
}
