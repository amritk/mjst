import {
  hasExclusiveMaximum,
  hasExclusiveMinimum,
  hasMaximum,
  hasMaxLength,
  hasMinimum,
  hasMinLength,
  hasMultipleOf,
  hasPattern,
} from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

/**
 * True when an already-chosen scalar value satisfies the node's own
 * length/range/pattern keywords.
 *
 * Both generators face the same question from opposite directions: the deriver
 * picks the first `enum`/`const` member that fits a sibling `minLength`, and the
 * arbitrary drops the members that do not fit before handing the rest to
 * `fc.constantFrom`. Answering it in two places let the two drift — the
 * arbitrary learned about `pattern` and the deriver did not, so the same schema
 * could yield an example the arbitrary would have rejected.
 *
 * Only *scalar* keywords are checked. A value that is neither a string nor a
 * number has nothing here to violate, so it passes; the full judgement is the
 * validator's job (see `makeInstanceCheck`).
 */
export const satisfiesScalarConstraints = (schema: JSONSchema, value: unknown): boolean => {
  if (typeof value === 'string') {
    if (hasMinLength(schema) && value.length < schema.minLength) return false
    if (hasMaxLength(schema) && value.length > schema.maxLength) return false
    if (hasPattern(schema)) {
      try {
        if (!new RegExp(schema.pattern).test(value)) return false
      } catch {
        // A pattern that is not a valid JavaScript regex cannot reject anything,
        // and throwing here would kill a generation run over a bad schema.
        return true
      }
    }
    return true
  }

  if (typeof value === 'number') {
    if (hasMinimum(schema) && value < schema.minimum) return false
    if (hasMaximum(schema) && value > schema.maximum) return false
    if (hasExclusiveMinimum(schema) && value <= schema.exclusiveMinimum) return false
    if (hasExclusiveMaximum(schema) && value >= schema.exclusiveMaximum) return false
    if (hasMultipleOf(schema) && schema.multipleOf > 0 && value % schema.multipleOf !== 0) return false
  }

  return true
}
