import type { RulesetFunction } from '../../../core'
import { isObject } from './helpers'

// Registered OpenAPI 3.2 Tag `kind` values (the field is extensible via a
// community registry, so this rule is recommended: false / opt-in).
const REGISTERED_TAG_KINDS = new Set(['nav', 'badge', 'audience'])

/** Flags a present-but-unregistered OpenAPI 3.2 Tag Object `kind` value. */
export const oasTagKind: RulesetFunction = (tag, _options, context) => {
  if (!isObject(tag) || typeof tag['kind'] !== 'string') return []
  if (REGISTERED_TAG_KINDS.has(tag['kind'])) return []
  return [
    {
      message: `Tag kind "${tag['kind']}" is not a registered value (${[...REGISTERED_TAG_KINDS].join(', ')})`,
      path: [...context.path, 'kind'],
    },
  ]
}
