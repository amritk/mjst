import type { IFunctionResult, RulesetFunction } from '../../../core'
import { isObject } from './helpers'

// Reusable component types that are referenced via `$ref` (securitySchemes are
// referenced by name in `security`, not via `$ref`, so they are excluded).
const REUSABLE_COMPONENT_TYPES = [
  'schemas',
  'responses',
  'parameters',
  'examples',
  'requestBodies',
  'headers',
  'links',
  'callbacks',
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
  const results: IFunctionResult[] = []
  for (const type of REUSABLE_COMPONENT_TYPES) {
    const group = components[type]
    if (!isObject(group)) continue
    for (const key of Object.keys(group)) {
      if (!refs.has(`#/components/${type}/${key}`)) {
        results.push({ message: 'Potentially unused component has been detected.', path: [...context.path, type, key] })
      }
    }
  }
  return results
}
