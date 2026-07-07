import type { RulesetFunction } from '../core'

/** Options for {@link xor}. */
export type IXorOptions = {
  properties: string[]
}

/** Flags an object unless exactly one of the listed `properties` is present. */
export const xor: RulesetFunction<Record<string, unknown>, IXorOptions> = (input, options) => {
  if (typeof input !== 'object' || input === null) return []
  const properties = options?.properties ?? []
  const present = properties.filter((property) => property in input)
  if (present.length !== 1) {
    return [{ message: `Exactly one of ${properties.map((p) => `"${p}"`).join(', ')} must be defined` }]
  }
  return []
}
