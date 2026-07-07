import type { IFunctionResult, RulesetFunction } from '../core'

/** Options for {@link alphabetical}. */
export type IAlphabeticalOptions = {
  /** Compare objects by this property instead of the value itself. */
  keyedBy?: string
}

const compare = (a: unknown, b: unknown): number => {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}

/** Flags array items or object keys that are not in ascending (optionally `keyedBy`) order. */
export const alphabetical: RulesetFunction<unknown, IAlphabeticalOptions> = (input, options, context) => {
  if (typeof input !== 'object' || input === null) return []

  const isArray = Array.isArray(input)
  const items: unknown[] = isArray ? input : Object.keys(input)
  const keyedBy = options?.keyedBy

  const results: IFunctionResult[] = []
  for (let i = 0; i < items.length - 1; i++) {
    let current = items[i]
    let next = items[i + 1]
    if (keyedBy) {
      current = isRecord(current) ? current[keyedBy] : current
      next = isRecord(next) ? next[keyedBy] : next
    }
    if (compare(current, next) > 0) {
      const path = isArray ? [...context.path, i + 1] : [...context.path, items[i + 1] as string]
      results.push({ message: 'The items must be in alphabetical order', path })
    }
  }
  return results
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
