import { getByPointer, pointerToPath } from './get-by-pointer'
import type { OriginMap, ResolveResult } from './types'

// A ref currently mid-resolution is marked with this sentinel; revisiting it
// means we have looped, so we return `{}` instead of recursing forever.
const CYCLE = Symbol('cycle')
type CacheValue = unknown | typeof CYCLE

/** Options for the in-memory resolver. */
export type ResolveRefsOptions = {
  /**
   * Record a per-node origin map on the result (`origins`). For every object or
   * array inlined in place of a `$ref`, the map records the in-document path it
   * was defined at (the `location` is `''`, the single in-memory document).
   * Defaults to `false`.
   */
  trackOrigins?: boolean
}

/**
 * Single-pass internal-only `$ref` resolver. Each unique ref string is resolved
 * exactly once (the `cache`); revisiting a ref that is still mid-resolution
 * means a cycle, so we return `{}` (the CYCLE sentinel). Non-`#` refs (external
 * files, HTTP) are left untouched — callers that need those should use
 * `resolveRefsFromFile`.
 */
const resolveInternal = (
  node: unknown,
  root: unknown,
  cache: Map<string, CacheValue>,
  origins: OriginMap | undefined,
): unknown => {
  if (node === null || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map((item) => resolveInternal(item, root, cache, origins))

  const obj = node as Record<string, unknown>
  if (typeof obj['$ref'] === 'string') {
    const ref = obj['$ref']
    if (!ref.startsWith('#')) return obj // external ref — leave as-is

    let target: unknown
    if (cache.has(ref)) {
      const cached = cache.get(ref)
      target = cached === CYCLE ? {} : cached
    } else {
      cache.set(ref, CYCLE)
      target = resolveInternal(getByPointer(root, ref.slice(1)), root, cache, origins)
      cache.set(ref, target)
      // Stamp the inlined node with the path it was defined at (see resolveAt).
      // First-write-wins so the deepest definition stamps before any outer ref that
      // transitively points at the same object. Primitives can't key the map.
      if (origins && target !== null && typeof target === 'object' && !origins.has(target)) {
        origins.set(target, { location: '', pointer: pointerToPath(ref.slice(1)) })
      }
    }

    // Per JSON Schema 2020-12, keywords sibling to `$ref` are *not* ignored: they
    // apply alongside the referenced schema. Preserve them by combining both in an
    // `allOf` (so a constraint present on both sides is never silently dropped)
    // rather than returning the bare target. The cache always stores the
    // sibling-free target so each occurrence applies its own siblings.
    const siblingKeys = Object.keys(obj).filter((key) => key !== '$ref')
    if (siblingKeys.length === 0) return target
    const siblings: Record<string, unknown> = {}
    for (const key of siblingKeys) siblings[key] = resolveInternal(obj[key], root, cache, origins)
    const existingAllOf = Array.isArray(siblings['allOf']) ? siblings['allOf'] : []
    const merged = { ...siblings, allOf: [...existingAllOf, target] }
    // Stamp the wrapper too, so a consumer mapping the resolved node back to its
    // origin finds one for a `$ref`-with-siblings node (not only the inner target).
    if (origins && !origins.has(merged)) origins.set(merged, { location: '', pointer: pointerToPath(ref.slice(1)) })
    return merged
  }

  const result: Record<string, unknown> = {}
  for (const key of Object.keys(obj)) {
    result[key] = resolveInternal(obj[key], root, cache, origins)
  }
  return result
}

/**
 * Resolves all internal (`#/...`) `$ref`s in an in-memory document, inlining
 * each target. External and remote refs are left as-is. Cycles are broken with
 * an empty object so the result is always finite.
 */
export const resolveRefs = (data: unknown, options: ResolveRefsOptions = {}): ResolveResult => {
  const origins: OriginMap | undefined = options.trackOrigins ? new Map() : undefined
  const resolved = resolveInternal(data, data, new Map(), origins)
  return origins ? { resolved, errors: [], origins } : { resolved, errors: [] }
}
