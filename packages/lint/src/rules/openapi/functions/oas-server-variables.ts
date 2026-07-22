import type { IFunctionResult, RulesetFunction } from '../../../core/types'
import { isObject } from './helpers'

/**
 * Validates a Server Object's `variables`, mirroring Spectral's `serverVariables`:
 * every `{template}` in the URL must have a matching variable and vice versa, and
 * each defined variable must have a `default`, a non-empty `enum` when present,
 * and a `default` that is listed in that `enum`.
 */
export const oasServerVariables: RulesetFunction = (server, _options, context) => {
  if (!isObject(server) || typeof server['url'] !== 'string') return []
  const templates = [...server['url'].matchAll(/\{([^}]+)\}/g)].map((m) => m[1] as string)
  const variables = isObject(server['variables']) ? server['variables'] : {}
  const results: IFunctionResult[] = []

  for (const template of templates) {
    if (!(template in variables)) {
      results.push({ message: `Server variable "${template}" is not defined`, path: [...context.path, 'variables'] })
    }
  }

  for (const [name, variable] of Object.entries(variables)) {
    if (!templates.includes(name)) {
      results.push({
        message: `Server variable "${name}" is not used in the URL`,
        path: [...context.path, 'variables', name],
      })
    }
    if (!isObject(variable)) continue
    const hasDefault = variable['default'] !== undefined
    if (!hasDefault) {
      results.push({
        message: `Server variable "${name}" has a missing default`,
        path: [...context.path, 'variables', name],
      })
    }
    if ('enum' in variable) {
      const enumValues = Array.isArray(variable['enum']) ? variable['enum'] : []
      if (enumValues.length === 0) {
        results.push({
          message: `Server variable "${name}" has an empty enum`,
          path: [...context.path, 'variables', name, 'enum'],
        })
      } else if (hasDefault && !enumValues.includes(variable['default'])) {
        results.push({
          message: `Server variable "${name}" has a default not listed in the enum`,
          path: [...context.path, 'variables', name, 'default'],
        })
      }
    }
  }

  return results
}
