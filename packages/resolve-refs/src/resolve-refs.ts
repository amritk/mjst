import { getByPointer } from './get-by-pointer'
import type { ResolveResult } from './types'

// A ref currently mid-resolution is marked with this sentinel; revisiting it
// means we have looped, so we return `{}` instead of recursing forever.
const CYCLE = Symbol('cycle')
type CacheValue = unknown | typeof CYCLE

/**
 * Single-pass internal-only `$ref` resolver. Each unique ref string is resolved
 * exactly once (the `cache`); revisiting a ref that is still mid-resolution
 * means a cycle, so we return `{}` (the CYCLE sentinel). Non-`#` refs (external
 * files, HTTP) are left untouched — callers that need those should use
 * `resolveRefsFromFile`.
 */
const resolveInternal = (node: unknown, root: unknown, cache: Map<string, CacheValue>): unknown => {
  if (node === null || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map((item) => resolveInternal(item, root, cache))

  const obj = node as Record<string, unknown>
  if (typeof obj['$ref'] === 'string') {
    const ref = obj['$ref']
    if (!ref.startsWith('#')) return obj // external ref — leave as-is
    if (cache.has(ref)) {
      const cached = cache.get(ref)
      return cached === CYCLE ? {} : cached
    }
    cache.set(ref, CYCLE)
    const resolved = resolveInternal(getByPointer(root, ref.slice(1)), root, cache)
    cache.set(ref, resolved)
    return resolved
  }

  const result: Record<string, unknown> = {}
  for (const key of Object.keys(obj)) {
    result[key] = resolveInternal(obj[key], root, cache)
  }
  return result
}

/**
 * Resolves all internal (`#/...`) `$ref`s in an in-memory document, inlining
 * each target. External and remote refs are left as-is. Cycles are broken with
 * an empty object so the result is always finite.
 */
export const resolveRefs = (data: unknown): ResolveResult => {
  const resolved = resolveInternal(data, data, new Map())
  return { resolved, errors: [] }
}
