import { pointerToPath } from './get-by-pointer'
import { type ResolvedTarget, readReference, resolveFragment } from './reference'
import { baseOfNode, buildResourceRegistry, type ResourceRegistry, resolveRefInScope } from './resource-registry'
import { assignKey } from './safe-assign'
import type { JsonPath, OriginMap, ResolveError, ResolveResult } from './types'

// A ref currently mid-resolution is marked with this sentinel; revisiting it
// means we have looped, so we keep the original reference instead of recursing
// forever (see the CYCLE branch below).
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
 * OpenAPI 3.1 Reference Objects allow only these annotation keywords beside a
 * `$ref`, and they *override* the target's — an `allOf` wrapper is not valid in
 * those positions (Path Item, Response, Parameter references). They carry no
 * validation semantics in plain JSON Schema either, so overriding is safe there
 * too; every other sibling keyword keeps the spec-correct `allOf` combination.
 */
const ANNOTATION_ONLY_SIBLINGS = new Set(['summary', 'description'])

/**
 * Single-pass internal `$ref` resolver. Each unique ref string is resolved
 * exactly once per scope (the `cache`); revisiting a ref that is still
 * mid-resolution means a cycle, so the original reference node is kept — its
 * target still exists in the resolved document, preserving the recursive
 * branch instead of collapsing it to `{}`. Refs that resolve to nothing in
 * this document (external files, HTTP) are left in place but recorded as an
 * error — callers that need those should use `resolveRefsFromFile`.
 *
 * `base` is the current `$id` base URI, used to scope anchor lookups and to
 * match refs against embedded resources (see `resource-registry.ts`).
 */
const resolveInternal = (
  node: unknown,
  root: unknown,
  registry: ResourceRegistry,
  base: string,
  cache: Map<string, CacheValue>,
  origins: OriginMap | undefined,
  errors: ResolveError[],
): unknown => {
  if (node === null || typeof node !== 'object') return node
  if (Array.isArray(node)) {
    return node.map((item) => resolveInternal(item, root, registry, base, cache, origins, errors))
  }

  const obj = node as Record<string, unknown>
  // A subschema's `$id` re-bases everything inside it, its own `$ref` included.
  const nodeBase = typeof obj['$id'] === 'string' ? baseOfNode(registry, obj, base) : base
  const reference = readReference(obj)
  if (reference) {
    const { keyword, value: ref } = reference

    // An external ref (another file or an http(s) URL) can't be dereferenced by
    // the in-memory resolver — it has no access to other documents. Record a
    // diagnostic and keep the original node, so callers see a half-resolved
    // document flagged rather than a silently-unresolved ref. Note this is
    // decided *after* `$id`-scope matching below: a non-`#` ref whose URI
    // matches an embedded resource's `$id` is internal, not external.
    const externalRef = (): unknown => {
      errors.push({
        message: `Cannot resolve external ${keyword} "${ref}": external ref requires resolveRefsFromFile`,
        path: [],
      })
      return obj
    }

    // Resolve within the document's `$id` scope. `$recursiveRef` ignores its
    // fragment and binds document-globally, so it skips the scoped path.
    let found: ResolvedTarget | undefined
    let targetBase = nodeBase
    if (keyword === '$recursiveRef') {
      found = resolveFragment(root, keyword, ref.startsWith('#') ? ref.slice(1) : ref)
      targetBase = registry.rootBase
    } else {
      const scoped = resolveRefInScope(registry, keyword, ref, nodeBase)
      if (scoped === 'external') return externalRef()
      if (scoped !== undefined) {
        found = scoped
        targetBase = scoped.base
      } else if (ref.startsWith('#')) {
        // Scope-aware lookup found nothing; fall back to the document-global
        // search for compatibility with documents that reference an anchor
        // declared in a sibling resource.
        found = resolveFragment(root, keyword, ref.slice(1))
        targetBase = registry.rootBase
      } else {
        return externalRef()
      }
    }

    // Cache/cycle key includes the keyword (`$ref #x` and `$dynamicRef #x` can
    // bind differently) and the base URI (the same anchor name can bind
    // differently inside different embedded resources).
    const cacheKey = `${keyword} ${nodeBase} ${ref}`
    let target: unknown
    let pointer: JsonPath
    const cached = cache.get(cacheKey)
    if (cached === MISSING) return obj
    if (cached === CYCLE) {
      // Mid-resolution revisit — a reference cycle. Keep the reference node
      // (siblings resolved, the ref itself verbatim): its target still exists
      // in the resolved document, so consumers resolve the recursion locally
      // rather than finding an empty `{}` where the recursive branch was.
      const kept: Record<string, unknown> = {}
      for (const key of Object.keys(obj)) {
        assignKey(
          kept,
          key,
          key === keyword ? obj[key] : resolveInternal(obj[key], root, registry, nodeBase, cache, origins, errors),
        )
      }
      return kept
    }
    if (cached !== undefined) {
      target = cached.target
      pointer = cached.pointer
    } else {
      cache.set(cacheKey, CYCLE)
      if (found === undefined) {
        // A reference that resolves to nothing (a typo'd pointer or a missing
        // anchor) was previously inlined as literal `undefined` with no trace.
        // Record it and keep the original node so the failure is visible.
        const fragment = ref.startsWith('#') ? ref.slice(1) : ref
        errors.push({
          message: `Cannot resolve internal ${keyword} "${ref}"`,
          path: fragment === '' || fragment.startsWith('/') ? pointerToPath(fragment) : [],
        })
        cache.set(cacheKey, MISSING)
        return obj
      }
      pointer = found.pointer
      target = resolveInternal(found.value, root, registry, targetBase, cache, origins, errors)
      cache.set(cacheKey, { target, pointer })
      // Stamp the inlined node with the path it was defined at (see resolveAt).
      // First-write-wins so the deepest definition stamps before any outer ref that
      // transitively points at the same object. Primitives can't key the map.
      if (origins && target !== null && typeof target === 'object' && !origins.has(target)) {
        origins.set(target, { location: '', pointer })
      }
    }

    const siblingKeys = Object.keys(obj).filter((key) => key !== keyword)
    if (siblingKeys.length === 0) return target
    const siblings: Record<string, unknown> = {}
    for (const key of siblingKeys) {
      assignKey(siblings, key, resolveInternal(obj[key], root, registry, nodeBase, cache, origins, errors))
    }

    // Annotation-only siblings (OpenAPI Reference Objects): inline the target
    // with the annotations overriding — never wrap in `allOf`, which is invalid
    // where those references appear (see ANNOTATION_ONLY_SIBLINGS).
    if (siblingKeys.every((key) => ANNOTATION_ONLY_SIBLINGS.has(key))) {
      if (target !== null && typeof target === 'object' && !Array.isArray(target)) {
        const overridden: Record<string, unknown> = {}
        for (const key of Object.keys(target)) assignKey(overridden, key, (target as Record<string, unknown>)[key])
        for (const key of Object.keys(siblings)) assignKey(overridden, key, siblings[key])
        if (origins && !origins.has(overridden)) origins.set(overridden, { location: '', pointer })
        return overridden
      }
      // A non-object target (boolean schema, primitive) has no members to
      // override; the annotations have nowhere to live, so return the target.
      return target
    }

    // Per JSON Schema 2020-12, keywords sibling to `$ref` are *not* ignored: they
    // apply alongside the referenced schema. Preserve them by combining both in an
    // `allOf` (so a constraint present on both sides is never silently dropped)
    // rather than returning the bare target. The cache always stores the
    // sibling-free target so each occurrence applies its own siblings.
    const existingAllOf = Array.isArray(siblings['allOf']) ? siblings['allOf'] : []
    const merged = { ...siblings, allOf: [...existingAllOf, target] }
    // Stamp the wrapper too, so a consumer mapping the resolved node back to its
    // origin finds one for a `$ref`-with-siblings node (not only the inner target).
    if (origins && !origins.has(merged)) origins.set(merged, { location: '', pointer })
    return merged
  }

  const result: Record<string, unknown> = {}
  for (const key of Object.keys(obj)) {
    assignKey(result, key, resolveInternal(obj[key], root, registry, nodeBase, cache, origins, errors))
  }
  return result
}

/**
 * Resolves all internal `$ref`s in an in-memory document — plain `#/...`
 * pointers, `$anchor`/`$dynamicAnchor` names (scoped by `$id`), and refs whose
 * URI matches an embedded resource's `$id` — inlining each target. Refs to
 * other files/URLs are left in place and reported on `errors` (this resolver
 * can't load other documents — use `resolveRefsFromFile` for those). Cycles are
 * broken by keeping the original reference node, so recursive schemas keep
 * their recursive branch.
 */
export const resolveRefs = (data: unknown, options: ResolveRefsOptions = {}): ResolveResult => {
  const origins: OriginMap | undefined = options.trackOrigins ? new Map() : undefined
  const errors: ResolveError[] = []
  const registry = buildResourceRegistry(data)
  const resolved = resolveInternal(data, data, registry, registry.rootBase, new Map(), origins, errors)
  return origins ? { resolved, errors, origins } : { resolved, errors }
}
