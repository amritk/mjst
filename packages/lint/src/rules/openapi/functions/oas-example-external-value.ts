import type { RulesetFunction } from '../../../core/types'
import { isObject } from './helpers'

/**
 * Enforces that an Example Object carries exactly one inline value source. Across
 * all of OpenAPI 3.x an Example must use either `value` or `externalValue` (not
 * both, not neither). OpenAPI 3.2 added `dataValue`/`serializedValue` as further
 * ways to supply the example, so their presence also satisfies the "has an
 * example" requirement — otherwise a valid 3.2 `dataValue`-only example would be
 * wrongly flagged. The mutual exclusivity of the new fields is policed separately
 * by `oas3_2-example-value`.
 */
export const oasExampleExternalValue: RulesetFunction = (example) => {
  if (!isObject(example)) return []
  // A 3.2 dataValue/serializedValue already provides the example, so value /
  // externalValue are optional in that case.
  if (example['dataValue'] !== undefined || example['serializedValue'] !== undefined) return []
  const present = ['value', 'externalValue'].filter((property) => property in example)
  if (present.length !== 1) {
    return [{ message: 'Example object must have exactly one of "value" or "externalValue"' }]
  }
  return []
}
