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
/** Options for {@link serverVariables}: which fields of the Server Object carry the address. */
export type IServerVariablesOptions = {
  /**
   * The address fields to read templates from. Defaults to `['url']`, which is
   * where OpenAPI and AsyncAPI 2.x put the whole address; AsyncAPI 3.0 split it
   * into `host` and `pathname` and passes those instead.
   *
   * Not a union of all three: OpenAPI's `oas3-server-variables` runs under a
   * recursive `$..links[*].server` given, so reading `host`/`pathname` there
   * turned any object with those keys — an example payload, say — into an
   * error-severity finding about undefined server variables.
   */
  addressFields?: readonly string[]
}

const DEFAULT_ADDRESS_FIELDS = ['url'] as const

export const serverVariables: RulesetFunction<unknown, IServerVariablesOptions | undefined> = (
  server,
  options,
  context,
) => {
  if (!isObject(server)) return []
  const fields = options?.addressFields ?? DEFAULT_ADDRESS_FIELDS
  const templated = fields
    .map((field) => (Object.hasOwn(server, field) ? server[field] : undefined))
    .filter((value): value is string => typeof value === 'string')
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
