import type { IFunctionResult, RulesetFunction } from '../../core/types'
import { isObject } from './helpers'

/**
 * Validates a Server Object's `variables`, mirroring Spectral's `serverVariables`:
 * every `{template}` in the address must have a matching variable and vice
 * versa, and each defined variable must have a `default`, a non-empty `enum`
 * when present, and a `default` that is listed in that `enum`.
 *
 * All three specs model the Server Object the same way — a templated address
 * plus a `variables` map — differing only in which field carries the address
 * (see {@link TEMPLATED_FIELDS}), so they run this one implementation. See
 * `oasServerVariables` and `aasServerVariables`.
 */
/**
 * The fields of a Server Object that may carry `{variable}` templates. OpenAPI
 * and AsyncAPI 2.x put the whole address in `url`; AsyncAPI 3.0 split it into
 * `host` and `pathname`, either of which may be templated.
 */
const TEMPLATED_FIELDS = ['url', 'host', 'pathname'] as const

export const serverVariables: RulesetFunction = (server, _options, context) => {
  if (!isObject(server)) return []
  const templated = TEMPLATED_FIELDS.map((field) => server[field]).filter(
    (value): value is string => typeof value === 'string',
  )
  if (templated.length === 0) return []
  // A `Set` alongside the list: the address's template count and the `variables`
  // map are both document-sized, so a linear membership scan per variable was
  // quadratic.
  const templates = templated.flatMap((value) => [...value.matchAll(/\{([^}]+)\}/g)].map((m) => m[1] as string))
  const templateNames = new Set(templates)
  const variables = isObject(server['variables']) ? server['variables'] : {}
  const results: IFunctionResult[] = []

  for (const template of templates) {
    // `Object.hasOwn`, not `in`: variable names come from the document's server
    // URL, so a `{constructor}` template matched `Object.prototype` and its
    // missing variable went unreported.
    if (!Object.hasOwn(variables, template)) {
      results.push({ message: `Server variable "${template}" is not defined`, path: [...context.path, 'variables'] })
    }
  }

  for (const [name, variable] of Object.entries(variables)) {
    if (!templateNames.has(name)) {
      results.push({
        message: `Server variable "${name}" is not used in the address`,
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
