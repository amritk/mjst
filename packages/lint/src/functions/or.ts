import type { RulesetFunction } from '../core/types'

/** Options for {@link or}. */
export type IOrOptions = {
  properties: string[]
}

/**
 * Flags an object when none of the listed `properties` is defined on it. Where
 * {@link xor} requires exactly one, `or` requires at least one — it stays quiet
 * as soon as a single listed property is present.
 */
export const or: RulesetFunction<Record<string, unknown>, IOrOptions> = (input, options) => {
  if (typeof input !== 'object' || input === null) return []
  const properties = options?.properties
  // Spectral validates that at least two properties are supplied and no-ops when
  // that is not the case, so we skip in silence rather than flag every node.
  if (!Array.isArray(properties) || properties.length < 2) return []

  const present = properties.filter((property) => property in input)
  if (present.length > 0) return []

  // Match Spectral's message: a long list is abbreviated to the first three
  // properties plus a count of the rest so the finding stays readable.
  if (properties.length > 4) {
    const shortProps = properties.slice(0, 3)
    const count = `${properties.length - 3} other properties must be defined`
    return [{ message: `At least one of "${shortProps.join('" or "')}" or ${count}` }]
  }
  return [{ message: `At least one of "${properties.join('" or "')}" must be defined` }]
}
