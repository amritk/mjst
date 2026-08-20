import type { IFunctionResult, RulesetFunction } from '../../../core/types'
import { collectReferencedPointers } from '../../../functions/ref-index'
import { isObject } from './helpers'

// Reusable component types that are referenced via `$ref` (securitySchemes are
// referenced by name in `security`, not via `$ref`, so they are excluded).
// `pathItems` was added in OpenAPI 3.1 (referenced from `webhooks` / `callbacks`).
const REUSABLE_COMPONENT_TYPES = [
  'schemas',
  'responses',
  'parameters',
  'examples',
  'requestBodies',
  'headers',
  'links',
  'callbacks',
  'pathItems',
] as const

/**
 * Flags reusable `components/*` entries that nothing `$ref`s. Spectral's
 * `oas3-unused-component` checks every reusable component type (not just
 * schemas), so we do too — run on the unresolved document.
 */
export const oasUnusedComponent: RulesetFunction = (components, _options, context) => {
  if (!isObject(components)) return []
  // A component counts as used when a `$ref` targets it OR points *into* it
  // (e.g. `#/components/schemas/Pet/properties/id` still uses `Pet`). The index
  // records each ref's ancestors, so an interior ref is a hit on the parent.
  const referenced = collectReferencedPointers(context.document.data)
  const results: IFunctionResult[] = []
  for (const type of REUSABLE_COMPONENT_TYPES) {
    const group = components[type]
    if (!isObject(group)) continue
    for (const key of Object.keys(group)) {
      if (!referenced.has(`#/components/${type}/${key}`)) {
        results.push({ message: 'Potentially unused component has been detected.', path: [...context.path, type, key] })
      }
    }
  }
  return results
}
