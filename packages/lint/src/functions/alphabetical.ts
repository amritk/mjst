import type { IFunctionResult, RulesetFunction } from '../core'

/** Options for {@link alphabetical}. */
export type IAlphabeticalOptions = {
  /** Compare objects by this property instead of the value itself. */
  keyedBy?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const isStringOrNumber = (value: unknown): value is string | number =>
  typeof value === 'string' || typeof value === 'number'

/** A string made up only of digits, e.g. an integer-like object key such as "10". */
const isIntegerLike = (value: unknown): value is string => typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value)

const compare = (a: unknown, b: unknown): number => {
  // Deliberate deviation from Spectral, which relies on source order and falls
  // back to `localeCompare`: JavaScript enumerates integer-like object keys in
  // ascending numeric order ({ "2": …, "10": … }), yet `localeCompare` sorts
  // "10" before "2" and would flag that natural key order as a violation.
  // Comparing integer-like strings numerically avoids that false positive.
  if (isIntegerLike(a) && isIntegerLike(b)) return Math.sign(Number(a) - Number(b))
  // Match Spectral: when either side is a real number or a numeric string,
  // compare numerically so mixed inputs like [2, "10"] read as ordered.
  if ((typeof a === 'number' || !Number.isNaN(Number(a))) && (typeof b === 'number' || !Number.isNaN(Number(b)))) {
    return Math.min(1, Math.max(-1, Number(a) - Number(b)))
  }
  if (typeof a !== 'string' || typeof b !== 'string') return 0
  return a.localeCompare(b)
}

/** Flags array items or object keys that are not in ascending (optionally `keyedBy`) order. */
export const alphabetical: RulesetFunction<unknown, IAlphabeticalOptions> = (input, options, context) => {
  if (typeof input !== 'object' || input === null) return []

  const isArray = Array.isArray(input)
  const rawItems: unknown[] = isArray ? input : Object.keys(input)
  const keyedBy = options?.keyedBy

  // Resolve the actual comparands. With `keyedBy` we read a property off each
  // item, which is only meaningful when every item is an object; otherwise the
  // comparison would silently run against `undefined`. Surface the same explicit
  // findings Spectral does instead of producing a misleading order violation.
  const items: unknown[] = []
  for (const item of rawItems) {
    if (keyedBy) {
      if (!isRecord(item)) return [{ message: 'The value must be an object' }]
      items.push(item[keyedBy])
    } else {
      items.push(item)
    }
  }
  if (!items.every(isStringOrNumber)) {
    return [{ message: 'The value must be one of the allowed types: number, string' }]
  }

  const results: IFunctionResult[] = []
  for (let i = 0; i < items.length - 1; i++) {
    if (compare(items[i], items[i + 1]) > 0) {
      const path = isArray ? [...context.path, i + 1] : [...context.path, rawItems[i + 1] as string]
      results.push({ message: 'The items must be in alphabetical order', path })
    }
  }
  return results
}
