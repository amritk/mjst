import { getByPointer, pointerToPath } from './get-by-pointer'
import type { RefKeyword } from './reference'
import type { JsonPath } from './types'

/**
 * JSON Schema 2020-12 `$id` base-URI scoping, modelled as a pre-computed
 * registry of the document's embedded resources and anchors.
 *
 * A subschema carrying `$id` is an *embedded resource*: it establishes a new
 * base URI (its `$id` resolved against the enclosing base), refs inside it
 * resolve against that base, and its anchors are scoped to it. Bundled schemas
 * lean on this — each `$defs` entry declares an absolute `$id` and the rest of
 * the document references it by URI rather than by `#/$defs/...` pointer.
 *
 * Supported subset (deliberate, documented in the package README):
 *
 * - Anchors (`$anchor`/`$dynamicAnchor`) resolve within the referencing
 *   resource's scope first, falling back to a document-global search — so
 *   duplicate anchor names under different `$id`s bind correctly.
 * - A ref whose URI (resolved against the enclosing base) matches an embedded
 *   resource's `$id` resolves to that resource without any fetching; a pointer
 *   or anchor fragment on such a ref applies *within* that resource.
 * - A plain `#/pointer` fragment stays **document-root-relative** (matching the
 *   previous behavior and what bundled real-world documents rely on), even when
 *   it appears inside an embedded resource.
 * - `$dynamicRef` prefers a `$dynamicAnchor` in scope, then degrades to `$ref`
 *   semantics. The full dynamic-scope algorithm (outermost anchor along the
 *   *runtime* reference chain) is not modelled — for the single bundled
 *   document this resolver produces, the two agree unless the same
 *   `$dynamicAnchor` name is redeclared across resources *and* dispatched
 *   through recursive scopes.
 * - Document *retrieval* is unaffected: which file/URL an external ref loads
 *   from is still derived from the referencing document's location, not from
 *   its `$id` — so a root `$id` naming a remote URL never turns a local
 *   sibling-file ref into a network fetch.
 */

/** A resolved scoped target: the node, its in-document path, and its base URI. */
export type ScopedTarget = { value: unknown; pointer: JsonPath; base: string }

export type ResourceRegistry = {
  /** Normalized absolute URI (fragment stripped) → embedded resource root. */
  resources: Map<string, { value: unknown; pointer: JsonPath }>
  /** `${base}#${name}` → target, for `$anchor` and `$dynamicAnchor` alike. */
  staticAnchors: Map<string, { value: unknown; pointer: JsonPath }>
  /** `${base}#${name}` → target, for `$dynamicAnchor` only. */
  dynamicAnchors: Map<string, { value: unknown; pointer: JsonPath }>
  /** The document root's base URI (its root `$id` resolved, or the initial base). */
  rootBase: string
  /** The document root value, for root-relative pointer lookups. */
  root: unknown
}

/**
 * The synthetic base used when a document has no natural URI to resolve
 * relative `$id`s against (an in-memory document, or a local file path — which
 * is not a URL). Uses the reserved `.invalid` TLD so it can never collide with
 * a real `$id`.
 */
export const SYNTHETIC_BASE = 'https://mjst-internal.invalid/document'

// Keywords whose values are data, not subschemas — an `$id`/`$anchor` key
// inside an enum member or example value is instance data, not a declaration.
const NON_SCHEMA_KEYWORDS = new Set(['enum', 'const', 'default', 'examples'])

/** `new URL(ref, base).href`, or `undefined` when the pair does not parse. */
export const resolveUri = (ref: string, base: string): string | undefined => {
  try {
    return new URL(ref, base).href
  } catch {
    return undefined
  }
}

/** Strips the fragment from an absolute URI string. */
const withoutFragment = (uri: string): string => {
  const hashIdx = uri.indexOf('#')
  return hashIdx === -1 ? uri : uri.slice(0, hashIdx)
}

/** Splits a ref string into its URI part and its fragment (pointer or anchor name). */
export const splitFragment = (ref: string): { uriPart: string; fragment: string } => {
  const hashIdx = ref.indexOf('#')
  return {
    uriPart: hashIdx === -1 ? ref : ref.slice(0, hashIdx),
    fragment: hashIdx === -1 ? '' : ref.slice(hashIdx + 1),
  }
}

/** The base URI a subschema establishes via `$id`, or the enclosing base. */
const baseAfterId = (node: Record<string, unknown>, enclosingBase: string): string => {
  const id = node['$id']
  if (typeof id !== 'string' || id === '') return enclosingBase
  const resolved = resolveUri(id, enclosingBase)
  // A draft-07-style `$id: "#name"` (or a malformed one) sets no new base.
  if (resolved === undefined) return enclosingBase
  const bare = withoutFragment(resolved)
  return bare === '' ? enclosingBase : bare
}

/**
 * Walks the document once, registering every embedded resource (`$id`) and
 * every anchor under the base URI it is scoped to. First declaration wins on
 * a duplicate URI or anchor name, matching document order.
 */
export const buildResourceRegistry = (root: unknown, initialBase: string = SYNTHETIC_BASE): ResourceRegistry => {
  const resources: ResourceRegistry['resources'] = new Map()
  const staticAnchors: ResourceRegistry['staticAnchors'] = new Map()
  const dynamicAnchors: ResourceRegistry['dynamicAnchors'] = new Map()

  const rootBase =
    root !== null && typeof root === 'object' && !Array.isArray(root)
      ? baseAfterId(root as Record<string, unknown>, initialBase)
      : initialBase

  const registerAnchors = (node: Record<string, unknown>, base: string, pointer: JsonPath): void => {
    const anchor = node['$anchor']
    if (typeof anchor === 'string') {
      const key = `${base}#${anchor}`
      if (!staticAnchors.has(key)) staticAnchors.set(key, { value: node, pointer })
    }
    const dynamicAnchor = node['$dynamicAnchor']
    if (typeof dynamicAnchor === 'string') {
      const key = `${base}#${dynamicAnchor}`
      // Per 2020-12 a `$dynamicAnchor` also creates an ordinary anchor.
      if (!dynamicAnchors.has(key)) dynamicAnchors.set(key, { value: node, pointer })
      if (!staticAnchors.has(key)) staticAnchors.set(key, { value: node, pointer })
    }
  }

  const walk = (node: unknown, base: string, pointer: JsonPath): void => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) walk(node[i], base, [...pointer, i])
      return
    }
    const record = node as Record<string, unknown>
    const nodeBase = baseAfterId(record, base)
    if (nodeBase !== base && !resources.has(nodeBase)) resources.set(nodeBase, { value: node, pointer })
    registerAnchors(record, nodeBase, pointer)
    for (const key of Object.keys(record)) {
      if (NON_SCHEMA_KEYWORDS.has(key)) continue
      walk(record[key], nodeBase, [...pointer, key])
    }
  }

  // The root registers under its own `$id` (when it has one) and under the
  // initial base, so both spellings of a self-reference resolve. `$id` first:
  // `baseOfNode` scans in insertion order, and refs inside the root must
  // resolve against its declared base, not the synthetic one.
  if (rootBase !== initialBase) resources.set(rootBase, { value: root, pointer: [] })
  if (!resources.has(withoutFragment(initialBase))) {
    resources.set(withoutFragment(initialBase), { value: root, pointer: [] })
  }
  walk(root, initialBase, [])

  return { resources, staticAnchors, dynamicAnchors, rootBase, root }
}

/**
 * Walks a JSON Pointer within `start`, tracking `$id` base changes along the
 * way so the returned target carries the base URI refs inside it resolve
 * against. Returns `undefined` when the pointer does not resolve.
 */
const getByPointerWithBase = (
  start: unknown,
  startBase: string,
  startPointer: JsonPath,
  fragment: string,
): ScopedTarget | undefined => {
  const value = getByPointer(start, fragment)
  if (value === undefined) return undefined

  // Re-walk the same path for base tracking only (cheap: fragment paths are short).
  let base = startBase
  let current: unknown = start
  for (const segment of pointerToPath(fragment)) {
    if (current === null || typeof current !== 'object') break
    if (!Array.isArray(current)) base = baseAfterId(current as Record<string, unknown>, base)
    current = (current as Record<string, unknown>)[segment as never]
  }
  if (current !== null && typeof current === 'object' && !Array.isArray(current)) {
    base = baseAfterId(current as Record<string, unknown>, base)
  }
  return { value, pointer: [...startPointer, ...pointerToPath(fragment)], base }
}

/** A fragment is a JSON Pointer when it is empty or begins with `/`; otherwise an anchor name. */
const isPointerFragment = (fragment: string): boolean => fragment === '' || fragment.startsWith('/')

/**
 * The base URI `node` establishes via its `$id`, as assigned during the
 * registry walk (identity lookup), or `enclosing` when it declares none that
 * registered. Resolvers call this while walking so refs inside an embedded
 * resource resolve against the right base.
 */
export const baseOfNode = (registry: ResourceRegistry, node: Record<string, unknown>, enclosing: string): string => {
  for (const [uri, resource] of registry.resources) {
    if (resource.value === node) return uri
  }
  return enclosing
}

/** Looks up an anchor name under `base`, honoring `$dynamicRef`'s preference order. */
const lookupAnchor = (registry: ResourceRegistry, keyword: RefKeyword, base: string, name: string) => {
  const key = `${base}#${name}`
  if (keyword === '$dynamicRef') return registry.dynamicAnchors.get(key) ?? registry.staticAnchors.get(key)
  return registry.staticAnchors.get(key)
}

/**
 * Resolves a reference within the document's `$id` scope. Returns:
 *
 * - a {@link ScopedTarget} when the ref resolves to something in this document
 *   (a root-relative pointer, an anchor in scope, or an embedded resource);
 * - `'external'` when the ref names a URI that matches no embedded resource —
 *   the caller decides whether to fetch it or leave it untouched;
 * - `undefined` when the ref *should* resolve here but nothing matches (a
 *   missing anchor, a bad pointer into an embedded resource) — the caller may
 *   fall back to a document-global search for compatibility.
 */
export const resolveRefInScope = (
  registry: ResourceRegistry,
  keyword: RefKeyword,
  ref: string,
  currentBase: string,
): ScopedTarget | 'external' | undefined => {
  const { uriPart, fragment } = splitFragment(ref)

  if (uriPart === '') {
    // A plain `#/pointer` stays document-root-relative (see module doc).
    if (isPointerFragment(fragment)) {
      return getByPointerWithBase(registry.root, registry.rootBase, [], fragment)
    }
    // An anchor name resolves within the current resource's scope.
    const anchored = lookupAnchor(registry, keyword, currentBase, fragment)
    return anchored === undefined ? undefined : { ...anchored, base: currentBase }
  }

  const absolute = resolveUri(ref, currentBase)
  if (absolute === undefined) return 'external'
  const resource = registry.resources.get(withoutFragment(absolute))
  if (resource === undefined) return 'external'

  if (isPointerFragment(fragment)) {
    const resourceBase = withoutFragment(absolute)
    return getByPointerWithBase(resource.value, resourceBase, resource.pointer, fragment)
  }
  const anchored = lookupAnchor(registry, keyword, withoutFragment(absolute), fragment)
  return anchored === undefined ? undefined : { ...anchored, base: withoutFragment(absolute) }
}
