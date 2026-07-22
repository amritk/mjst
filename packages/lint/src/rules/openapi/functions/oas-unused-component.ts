import type { IFunctionResult, RulesetFunction } from '../../../core/types'
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

/** Collects every `$ref` string anywhere in `node` into `into`. */
const collectRefs = (node: unknown, into: Set<string>): void => {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, into)
    return
  }
  if (isObject(node)) {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') into.add(value)
      else collectRefs(value, into)
    }
  }
}

/**
 * Flags reusable `components/*` entries that nothing `$ref`s. Spectral's
 * `oas3-unused-component` checks every reusable component type (not just
 * schemas), so we do too — run on the unresolved document.
 */
export const oasUnusedComponent: RulesetFunction = (components, _options, context) => {
  if (!isObject(components)) return []
  const refs = new Set<string>()
  collectRefs(context.document.data, refs)
  // A component counts as used when a `$ref` targets it OR points *into* it
  // (e.g. `#/components/schemas/Pet/properties/id` still uses `Pet`), so match by
  // prefix rather than exact string — an interior ref must not leave the parent
  // flagged as unused.
  const isReferenced = (base: string): boolean => {
    for (const ref of refs) {
      if (ref === base || ref.startsWith(`${base}/`)) return true
    }
    return false
  }
  const results: IFunctionResult[] = []
  for (const type of REUSABLE_COMPONENT_TYPES) {
    const group = components[type]
    if (!isObject(group)) continue
    for (const key of Object.keys(group)) {
      if (!isReferenced(`#/components/${type}/${key}`)) {
        results.push({ message: 'Potentially unused component has been detected.', path: [...context.path, type, key] })
      }
    }
  }
  return results
}
