import type { IFunctionResult, RulesetFunction } from '../../../core'
import { isObject } from './helpers'

/** Validates server variables are declared and used. */
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
  for (const name of Object.keys(variables)) {
    if (!templates.includes(name)) {
      results.push({
        message: `Server variable "${name}" is not used in the URL`,
        path: [...context.path, 'variables', name],
      })
    }
  }
  return results
}
