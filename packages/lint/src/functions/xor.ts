import type { RulesetFunction } from '../core/types'

/** Options for {@link xor}. */
export type IXorOptions = {
  properties: string[]
}

/** Flags an object unless exactly one of the listed `properties` is present. */
export const xor: RulesetFunction<Record<string, unknown>, IXorOptions> = (input, options) => {
  if (typeof input !== 'object' || input === null) return []
  const properties = options?.properties
  // Spectral validates the option schema (an array of at least two strings)
  // before the function runs and no-ops when it fails, so with fewer than two
  // properties there is nothing meaningful to check. We deliberately skip in
  // silence rather than push an error: an empty or single-element list would
  // otherwise flag every node with a message that names nothing useful.
  if (!Array.isArray(properties) || properties.length < 2) return []
  // `Object.hasOwn`, not `in`: a rule that lists `constructor` (or `toString`)
  // means the document's own key, and `in` answers it from `Object.prototype`.
  const present = properties.filter((property) => Object.hasOwn(input, property))
  if (present.length !== 1) {
    return [{ message: `Exactly one of ${properties.map((p) => `"${p}"`).join(', ')} must be defined` }]
  }
  return []
}
