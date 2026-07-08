import { pointerToPath } from './get-by-pointer'
import { type ResolvedTarget, readReference, resolveFragment } from './reference'
import { assignKey } from './safe-assign'
import type { JsonPath, OriginMap, ResolveError, ResolveResult } from './types'

// A ref currently mid-resolution is marked with this sentinel; revisiting it
// means we have looped, so we return `{}` instead of recursing forever.
const CYCLE = Symbol('cycle')
// A ref that resolved to nothing; cached so a repeated bad ref reports once.
const MISSING = Symbol('missing')
// The inlined target plus the in-document path it came from (for `origins`).
type CacheValue = { target: unknown; pointer: JsonPath } | typeof CYCLE | typeof MISSING

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
  errors: ResolveError[],
): unknown => {
  if (node === null || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map((item) => resolveInternal(item, root, cache, origins, errors))

  const obj = node as Record<string, unknown>
  const reference = readReference(obj)
  if (reference) {
    const { keyword, value: ref } = reference
    if (!ref.startsWith('#')) return obj // external ref — leave as-is

    // Cache/cycle key includes the keyword: `$ref #x` and `$dynamicRef #x` can
    // bind to different targets, so they must not share a cache slot.
    const cacheKey = `${keyword} ${ref}`
    let target: unknown
    let pointer: JsonPath
    const cached = cache.get(cacheKey)
    if (cached === MISSING) return obj
    if (cached === CYCLE) {
      target = {}
      pointer = []
    } else if (cached !== undefined) {
      target = cached.target
      pointer = cached.pointer
    } else {
      cache.set(cacheKey, CYCLE)
      const found: ResolvedTarget | undefined = resolveFragment(root, keyword, ref.slice(1))
      if (found === undefined) {
        // A reference that resolves to nothing (a typo'd pointer or a missing
        // anchor) was previously inlined as literal `undefined` with no trace.
        // Record it and keep the original node so the failure is visible.
        const fragment = ref.slice(1)
        errors.push({
          message: `Cannot resolve internal ${keyword} "${ref}"`,
          path: fragment === '' || fragment.startsWith('/') ? pointerToPath(fragment) : [],
        })
        cache.set(cacheKey, MISSING)
        return obj
      }
      pointer = found.pointer
      target = resolveInternal(found.value, root, cache, origins, errors)
      cache.set(cacheKey, { target, pointer })
      // Stamp the inlined node with the path it was defined at (see resolveAt).
      // First-write-wins so the deepest definition stamps before any outer ref that
      // transitively points at the same object. Primitives can't key the map.
      if (origins && target !== null && typeof target === 'object' && !origins.has(target)) {
        origins.set(target, { location: '', pointer })
      }
    }

    // Per JSON Schema 2020-12, keywords sibling to `$ref` are *not* ignored: they
    // apply alongside the referenced schema. Preserve them by combining both in an
    // `allOf` (so a constraint present on both sides is never silently dropped)
    // rather than returning the bare target. The cache always stores the
    // sibling-free target so each occurrence applies its own siblings.
    const siblingKeys = Object.keys(obj).filter((key) => key !== keyword)
    if (siblingKeys.length === 0) return target
    const siblings: Record<string, unknown> = {}
    for (const key of siblingKeys) assignKey(siblings, key, resolveInternal(obj[key], root, cache, origins, errors))
    const existingAllOf = Array.isArray(siblings['allOf']) ? siblings['allOf'] : []
    const merged = { ...siblings, allOf: [...existingAllOf, target] }
    // Stamp the wrapper too, so a consumer mapping the resolved node back to its
    // origin finds one for a `$ref`-with-siblings node (not only the inner target).
    if (origins && !origins.has(merged)) origins.set(merged, { location: '', pointer })
    return merged
  }

  const result: Record<string, unknown> = {}
  for (const key of Object.keys(obj)) {
    assignKey(result, key, resolveInternal(obj[key], root, cache, origins, errors))
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
  const errors: ResolveError[] = []
  const resolved = resolveInternal(data, data, new Map(), origins, errors)
  return origins ? { resolved, errors, origins } : { resolved, errors }
}
