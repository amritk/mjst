// This file is used as a template — it gets copied to user output directories.
// The relative path below must reflect the output structure (validators/ → ../helpers/),
// not the source package structure.
import { isObject } from '../helpers/is-object'

/**
 * Parses the values of a record with a parser function.
 * Uses for...in instead of Object.entries() to avoid allocating an intermediate array.
 */
export const validateRecord = (input: unknown, parser: (input: unknown) => unknown) => {
  if (!isObject(input)) {
    return {}
  }

  const record = input as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const key in record) {
    result[key] = parser(record[key])
  }

  return result
}
