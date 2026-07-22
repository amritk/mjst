import type { IFunctionResult, RulesetFunction } from '../../../core/types'
import { isObject } from './helpers'

/** Flags duplicate OpenAPI 3.2 Server Object `name` values across the servers array. */
export const oasServerNameUnique: RulesetFunction = (servers, _options, context) => {
  if (!Array.isArray(servers)) return []
  const seen = new Set<string>()
  const results: IFunctionResult[] = []
  servers.forEach((server, index) => {
    if (!isObject(server) || typeof server['name'] !== 'string') return
    if (seen.has(server['name'])) {
      results.push({
        message: `Server name "${server['name']}" must be unique`,
        path: [...context.path, index, 'name'],
      })
    }
    seen.add(server['name'])
  })
  return results
}
