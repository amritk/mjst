import type { IFunctionResult, RulesetFunction } from '../../../core/types'
import { isObject } from './helpers'

// OpenAPI 3.2 Example Object exclusivity (MUST-level, per the spec's field
// table). The `value`/`externalValue` pair is intentionally omitted here — the
// 3.x-wide `oas3-examples-value-or-externalValue` rule already covers it, so we
// only police the constraints introduced with the new `dataValue` /
// `serializedValue` fields to avoid double-reporting.
const EXAMPLE_EXCLUSIONS: { field: string; conflicts: string[] }[] = [
  // dataValue MUST NOT accompany value.
  { field: 'dataValue', conflicts: ['value'] },
  // serializedValue MUST NOT accompany value or externalValue.
  { field: 'serializedValue', conflicts: ['value', 'externalValue'] },
]

/** Flags forbidden field combinations on an OpenAPI 3.2 Example Object. */
export const oasExampleValue: RulesetFunction = (example, _options, context) => {
  if (!isObject(example)) return []
  const results: IFunctionResult[] = []
  for (const { field, conflicts } of EXAMPLE_EXCLUSIONS) {
    if (example[field] === undefined) continue
    for (const other of conflicts) {
      if (example[other] !== undefined) {
        results.push({
          message: `"${field}" must not be used together with "${other}"`,
          path: [...context.path, other],
        })
      }
    }
  }
  return results
}
