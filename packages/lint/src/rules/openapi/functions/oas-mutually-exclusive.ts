import type { RulesetFunction } from '../../../core/types'
import { isObject } from './helpers'

/**
 * Flags objects that carry more than one of a set of mutually exclusive
 * properties. OpenAPI 3.1's License Object, for example, defines `identifier`
 * (SPDX) as "mutually exclusive of the url field" — neither, or exactly one, is
 * allowed, but not both.
 */
export const oasMutuallyExclusive: RulesetFunction<Record<string, unknown>, { properties: string[] }> = (
  input,
  options,
  context,
) => {
  if (!isObject(input)) return []
  const present = (options?.properties ?? []).filter((property) => input[property] !== undefined)
  if (present.length <= 1) return []
  // The first present property is the "anchor"; flag every later one as the conflict.
  const [anchor, ...conflicts] = present
  return conflicts.map((property) => ({
    message: `"${property}" must not be used together with "${anchor}" (mutually exclusive)`,
    path: [...context.path, property],
  }))
}
