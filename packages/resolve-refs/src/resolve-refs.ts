import { childRole, type NodeRole } from './child-role'
import {
  bindsAtEvaluationTime,
  declaresAmbiguousAnchor,
  inliningKeepsScope,
  isScopeSensitive,
  type ScopeSensitiveNodes,
} from './dynamic-scope'
import { pointerToPath } from './get-by-pointer'
import { DEFAULT_MAX_DEPTH, depthLimitError } from './max-depth'
import { ANNOTATION_ONLY_SIBLINGS, type ResolvedTarget, readReference, resolveFragment } from './reference'
import { baseOfNode, buildResourceRegistry, type ResourceRegistry, resolveRefInScope } from './resource-registry'
import { roleAtPath } from './role-at-path'
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
  /**
   * How deep the resolver walks before leaving a subtree unresolved and
   * recording an error. Defaults to `512`. The walk is recursive, so a
   * pathologically nested document would otherwise unwind the stack with a
   * `RangeError` — a thrown error this package promises never to throw.
   */
  maxDepth?: number
}

/**
 * The depth budget for one resolve pass, carried through the walk. `reported`
 * is mutable on purpose: it is how the walk records the limit exactly once
 * instead of once per branch that trips it.
 */
type DepthLimits = { maxDepth: number; reported: boolean }

/**
 * Single-pass internal `$ref` resolver. Each unique ref string is resolved
 * exactly once per scope (the `cache`). Refs that resolve to nothing in this
 * document (external files, HTTP) are left in place but recorded as an error —
 * callers that need those should use `resolveRefsFromFile`.
 *
 * Two situations make a reference unanswerable at resolve time, and both are
 * handled the same way — the reference node is kept, siblings resolved and the
 * reference itself verbatim, for the consumer to resolve against the output
 * document:
 *
 * - a **cycle** (revisiting a ref that is still mid-resolution), because the
 *   target still exists in the resolved document and expanding it would not
 *   terminate;
 * - a **`$dynamicRef` that binds at evaluation time**, because inlining would
 *   pick one of the several targets it may bind to (see `dynamic-scope.ts`).
 *   The same reasoning then propagates outwards: a `$ref` whose target is, or
 *   contains, one of those is kept too when inlining it would move it out of
 *   the resource that scopes it.
 *
 * `base` is the current `$id` base URI, used to scope anchor lookups and to
 * match refs against embedded resources (see `resource-registry.ts`).
 *
 * `role` is where the node sits in the vocabulary (see `child-role.ts`): only a
 * schema position carries references, so a `$ref` inside an `enum` member stays
 * the data it is.
 *
 * `sensitive` collects the output nodes that must not be relocated across an
 * `$id` boundary — the kept references and the `$dynamicAnchor`s they may reach.
 */
const resolveInternal = (
  node: unknown,
  root: unknown,
  registry: ResourceRegistry,
  base: string,
  cache: Map<string, CacheValue>,
  origins: OriginMap | undefined,
  errors: ResolveError[],
  limits: DepthLimits,
  depth: number,
  role: NodeRole,
  sensitive: ScopeSensitiveNodes,
): unknown => {
  if (node === null || typeof node !== 'object') return node
  // Instance data: `enum`, `const`, `default` and `examples` hold values, so
  // whatever keys they contain are part of the value. Hand the subtree back
  // untouched rather than reading a `$ref` (or an `$id`) out of a literal.
  if (role === 'value') return node
  if (depth > limits.maxDepth) {
    // Past the limit we hand the subtree back untouched instead of unwinding the
    // stack with a RangeError. Nothing is lost — the branch simply keeps its
    // `$ref`s — and the failure is on `errors` where callers look. Reported once
    // per resolve: a document that is wide *and* deep would otherwise push an
    // error per branch and turn the error array into its own memory problem.
    if (!limits.reported) {
      limits.reported = true
      errors.push(depthLimitError(limits.maxDepth))
    }
    return node
  }
  if (Array.isArray(node)) {
    const items = node.map((item, index) =>
      resolveInternal(
        item,
        root,
        registry,
        base,
        cache,
        origins,
        errors,
        limits,
        depth + 1,
        childRole(role, index),
        sensitive,
      ),
    )
    if (items.some((item) => isScopeSensitive(sensitive, item))) sensitive.add(items)
    return items
  }

  const obj = node as Record<string, unknown>
  // A map of author-chosen names to schemas (`properties`, `$defs`, …) is not
  // itself a schema: a property named `$ref` or `$id` is a property name, so the
  // map's own keys are never read as keywords.
  const isSchema = role !== 'schemaMap'
  // A subschema's `$id` re-bases everything inside it, its own `$ref` included.
  const nodeBase = isSchema && typeof obj['$id'] === 'string' ? baseOfNode(registry, obj, base) : base
  const reference = isSchema ? readReference(obj) : undefined
  if (reference) {
    const { keyword, value: ref } = reference

    // The reference node, kept: siblings resolved, the reference itself
    // verbatim. This is what the resolver returns whenever it cannot answer a
    // reference without changing the document's meaning, so the consumer
    // resolves it against the output exactly as it would have against the
    // input. The result is scope-sensitive by definition — it is resolved later,
    // against whatever base it ends up standing in.
    const keepReference = (): Record<string, unknown> => {
      const kept: Record<string, unknown> = {}
      for (const key of Object.keys(obj)) {
        assignKey(
          kept,
          key,
          key === keyword
            ? obj[key]
            : resolveInternal(
                obj[key],
                root,
                registry,
                nodeBase,
                cache,
                origins,
                errors,
                limits,
                depth + 1,
                childRole(role, key),
                sensitive,
              ),
        )
      }
      sensitive.add(kept)
      return kept
    }

    // A `$dynamicRef` naming an anchor that is declared more than once has no
    // single target to inline — the dynamic scope picks one when the document is
    // evaluated. Keep the keyword and let the validator answer it.
    if (bindsAtEvaluationTime(keyword, ref, registry.ambiguousDynamicAnchors)) return keepReference()

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
      // Mid-resolution revisit — a reference cycle. Keep the reference node: its
      // target still exists in the resolved document, so consumers resolve the
      // recursion locally rather than finding an empty `{}` where the recursive
      // branch was.
      return keepReference()
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
      // The target is walked with the role it has where it is *defined*, so the
      // same ref resolves the same way whoever points at it (see roleAtPath).
      target = resolveInternal(
        found.value,
        root,
        registry,
        targetBase,
        cache,
        origins,
        errors,
        limits,
        depth + 1,
        roleAtPath(pointer),
        sensitive,
      )
      cache.set(cacheKey, { target, pointer })
      // Stamp the inlined node with the path it was defined at (see resolveAt).
      // First-write-wins so the deepest definition stamps before any outer ref that
      // transitively points at the same object. Primitives can't key the map.
      if (origins && target !== null && typeof target === 'object' && !origins.has(target)) {
        origins.set(target, { location: '', pointer })
      }
    }

    // Inlining copies the target into *this* node's `$id` scope. When the target
    // carries something whose meaning is fixed by the scope it was defined in —
    // a kept `$dynamicRef`, or a `$dynamicAnchor` one of those may bind to — the
    // move would quietly rewrite the answer, so keep the reference instead and
    // leave the scaffolding where the document put it.
    if (isScopeSensitive(sensitive, target) && !inliningKeepsScope(target, nodeBase, targetBase)) {
      return keepReference()
    }

    const siblingKeys = Object.keys(obj).filter((key) => key !== keyword)
    if (siblingKeys.length === 0) return target
    const siblings: Record<string, unknown> = {}
    let siblingIsSensitive = false
    for (const key of siblingKeys) {
      const child = resolveInternal(
        obj[key],
        root,
        registry,
        nodeBase,
        cache,
        origins,
        errors,
        limits,
        depth + 1,
        childRole(role, key),
        sensitive,
      )
      assignKey(siblings, key, child)
      if (isScopeSensitive(sensitive, child)) siblingIsSensitive = true
    }
    // The reference node may itself be scaffolding: a schema can carry both a
    // `$dynamicAnchor` and a reference, and the anchor still has to stay in the
    // resource that registers it.
    const inlineIsSensitive =
      siblingIsSensitive ||
      isScopeSensitive(sensitive, target) ||
      declaresAmbiguousAnchor(obj, registry.ambiguousDynamicAnchors)

    // Annotation-only siblings (OpenAPI Reference Objects): inline the target
    // with the annotations overriding — never wrap in `allOf`, which is invalid
    // where those references appear (see ANNOTATION_ONLY_SIBLINGS).
    if (siblingKeys.every((key) => ANNOTATION_ONLY_SIBLINGS.has(key))) {
      if (target !== null && typeof target === 'object' && !Array.isArray(target)) {
        const overridden: Record<string, unknown> = {}
        for (const key of Object.keys(target)) assignKey(overridden, key, (target as Record<string, unknown>)[key])
        for (const key of Object.keys(siblings)) assignKey(overridden, key, siblings[key])
        if (origins && !origins.has(overridden)) origins.set(overridden, { location: '', pointer })
        if (inlineIsSensitive) sensitive.add(overridden)
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
    if (inlineIsSensitive) sensitive.add(merged)
    return merged
  }

  const result: Record<string, unknown> = {}
  for (const key of Object.keys(obj)) {
    const child = resolveInternal(
      obj[key],
      root,
      registry,
      nodeBase,
      cache,
      origins,
      errors,
      limits,
      depth + 1,
      childRole(role, key),
      sensitive,
    )
    assignKey(result, key, child)
    if (isScopeSensitive(sensitive, child)) sensitive.add(result)
  }
  // A `$dynamicAnchor` a kept `$dynamicRef` might bind to is scaffolding: it
  // registers its name against the resource it sits in, so it has to stay there.
  if (isSchema && declaresAmbiguousAnchor(obj, registry.ambiguousDynamicAnchors)) sensitive.add(result)
  return result
}

/**
 * Resolves all internal `$ref`s in an in-memory document — plain `#/...`
 * pointers, `$anchor`/`$dynamicAnchor` names (scoped by `$id`), and refs whose
 * URI matches an embedded resource's `$id` — inlining each target. Refs to
 * other files/URLs are left in place and reported on `errors` (this resolver
 * can't load other documents — use `resolveRefsFromFile` for those).
 *
 * Only references in *schema* positions are inlined: a `$ref`-shaped object
 * inside `enum`, `const`, `default` or `examples` is instance data and is kept
 * verbatim (see `child-role.ts`).
 *
 * **Not every reference can be inlined, and the ones that cannot are kept.** The
 * output is a dereferenced document with two documented exceptions, both of
 * which resolve *within* the output:
 *
 * - a **cycle** keeps its reference node, so a recursive schema keeps its
 *   recursive branch instead of collapsing to `{}`;
 * - a **`$dynamicRef` that binds at evaluation time** keeps its keyword, along
 *   with the `$dynamicAnchor`s it may bind to and the `$id`s scoping them.
 *   Inlining one target would be a guess, and a wrong guess changes what the
 *   document accepts; a reference kept in place does not (see
 *   `dynamic-scope.ts`). A `$ref` whose target carries that scaffolding is kept
 *   for the same reason when inlining it would move the scaffolding out of the
 *   resource that scopes it.
 *
 * Neither is an error — nothing failed — so neither appears on `errors`, and
 * neither is inlined, so neither is stamped in `origins`. A consumer walking the
 * output should treat a leftover `$ref`/`$dynamicRef` the way it treats one in
 * the input.
 *
 * @example
 * ```ts
 * const { resolved, errors } = resolveRefs(document)
 * // Errors are COLLECTED, never thrown — always check `errors`.
 * // External ($ref to another file/URL) refs stay in place; use
 * // resolveRefsFromFile('./schema.json', { allowedHosts: [...] }) for those.
 * ```
 */
export const resolveRefs = (data: unknown, options: ResolveRefsOptions = {}): ResolveResult => {
  const origins: OriginMap | undefined = options.trackOrigins ? new Map() : undefined
  const errors: ResolveError[] = []
  const limits: DepthLimits = { maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH, reported: false }
  const registry = buildResourceRegistry(data, undefined, limits.maxDepth)
  // The document root is a schema; every other role follows from its keys.
  const resolved = resolveInternal(
    data,
    data,
    registry,
    registry.rootBase,
    new Map(),
    origins,
    errors,
    limits,
    0,
    'schema',
    new WeakSet(),
  )
  return origins ? { resolved, errors, origins } : { resolved, errors }
}
