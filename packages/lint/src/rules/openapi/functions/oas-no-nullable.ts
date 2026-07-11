import type { RulesetFunction } from '../../../core'
import { isObject } from './helpers'

/**
 * Flags a Schema Object's `nullable` keyword, removed in OpenAPI 3.1+ (JSON
 * Schema 2020-12 uses a `"null"` type instead). Targets the *parent* of a
 * `nullable` key (`$..nullable^`) rather than `$..nullable` directly, which fixes
 * two problems with the naive `then: falsy` approach:
 *   - a property literally named `nullable` (`properties: { nullable: {...} }`)
 *     is no longer flagged, because there the `nullable` value is a Schema Object,
 *     not the boolean keyword, and
 *   - `nullable: false` is flagged too (a boolean of either value counts as the
 *     keyword being present), so the migration fixer can drop it.
 */
export const oasNoNullable: RulesetFunction = (parent, _options, context) => {
  if (!isObject(parent) || typeof parent['nullable'] !== 'boolean') return []
  return [
    {
      message: 'nullable is not available in OpenAPI 3.1 or later; use a "null" type instead.',
      path: [...context.path, 'nullable'],
    },
  ]
}
