import { childRole, type NodeRole } from './child-role'
import { getByPointer, isPointerFragment, pointerToPath } from './get-by-pointer'
import { DEFAULT_MAX_DEPTH } from './max-depth'
import type { JsonPath } from './types'

/**
 * The reference keywords JSON Schema uses to point at another schema. `$ref`
 * (all drafts) is a static pointer; `$dynamicRef` (2020-12) and `$recursiveRef`
 * (2019-09) late-bind to an anchor so a recursive/extensible schema can refer to
 * itself. We inline all three; the dynamic forms bind to their document-global
 * anchor (see {@link resolveFragment}).
 */
export type RefKeyword = '$ref' | '$dynamicRef' | '$recursiveRef'

// `$ref` is listed first so that a node carrying several reference keywords
// resolves through the static one, matching how validators treat `$ref`.
const REF_KEYWORDS: readonly RefKeyword[] = ['$ref', '$dynamicRef', '$recursiveRef']

/**
 * OpenAPI 3.1 Reference Objects allow only these annotation keywords beside a
 * `$ref`, and they *override* the target's — an `allOf` wrapper is not valid in
 * those positions (Path Item, Response, Parameter references). They carry no
 * validation semantics in plain JSON Schema either, so overriding is safe there
 * too; every other sibling keyword keeps the spec-correct `allOf` combination.
 */
export const ANNOTATION_ONLY_SIBLINGS = new Set(['summary', 'description'])

/** A reference carried by an object: which keyword, and its string value. */
export type Reference = { keyword: RefKeyword; value: string }

/** Returns the reference keyword `obj` carries (if any), preferring `$ref`. */
export const readReference = (obj: Record<string, unknown>): Reference | undefined => {
  for (const keyword of REF_KEYWORDS) {
    const value = obj[keyword]
    if (typeof value === 'string') return { keyword, value }
  }
  return undefined
}

/** The resolved target of a reference: the node and the path to it within its document. */
export type ResolvedTarget = { value: unknown; pointer: JsonPath }

/**
 * Depth-first search for the first object in `root` satisfying `predicate`,
 * returning it with the path to it. `seen` guards against cyclic inputs. Used to
 * locate `$anchor`/`$dynamicAnchor`/`$recursiveAnchor` targets.
 *
 * The search is role-aware (see `child-role.ts`) so an anchor is only found
 * where an anchor can be *declared*: an `$anchor` key inside an `enum` member is
 * part of that value, and one under `properties` is a property name.
 */
const search = (root: unknown, predicate: (obj: Record<string, unknown>) => boolean): ResolvedTarget | undefined => {
  const seen = new Set<object>()
  // Depth-capped like every other walk in the package: this one is recursive
  // too, and an anchor lookup must not be the thing that blows the stack on a
  // pathologically nested document. An anchor buried past the cap simply is not
  // found, which the callers already report as an unresolvable reference.
  const walk = (node: unknown, pointer: JsonPath, depth: number, role: NodeRole): ResolvedTarget | undefined => {
    if (node === null || typeof node !== 'object' || seen.has(node) || depth > DEFAULT_MAX_DEPTH) return undefined
    if (role === 'value') return undefined
    seen.add(node)
    if (!Array.isArray(node) && role !== 'schemaMap' && predicate(node as Record<string, unknown>)) {
      return { value: node, pointer }
    }
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const found = walk(node[i], [...pointer, i], depth + 1, childRole(role, i))
        if (found) return found
      }
    } else {
      for (const key of Object.keys(node)) {
        const found = walk((node as Record<string, unknown>)[key], [...pointer, key], depth + 1, childRole(role, key))
        if (found) return found
      }
    }
    return undefined
  }
  return walk(root, [], 0, 'schema')
}

/**
 * Resolves a reference `fragment` (the part after `#`) within `root`, per its
 * `keyword`. Returns the target node and its in-document path, or `undefined`
 * when nothing matches.
 *
 * - **JSON Pointer** (`''`, `/a/b`) — a plain pointer lookup, for any keyword.
 * - **`$anchor` name** (`node`) — searches for a `$anchor`/`$dynamicAnchor` equal
 *   to the name. A `$dynamicRef` prefers a `$dynamicAnchor`, then falls back to a
 *   plain `$anchor`, so it degrades to `$ref` semantics when nothing dynamic
 *   matches (2020-12).
 * - **`$recursiveRef`** (always `#`) — binds to the object carrying
 *   `$recursiveAnchor: true`, falling back to the document root when there is
 *   none (2019-09).
 *
 * Anchor search is document-global: we bind to the single matching anchor in
 * `root` rather than walking the dynamic scope. This is the *fallback* path —
 * the resolvers first try `$id`-scoped resolution via `resource-registry.ts`,
 * which binds duplicate anchor names to the resource they are declared in, and
 * only land here for anchors declared outside any registered scope.
 */
export const resolveFragment = (root: unknown, keyword: RefKeyword, fragment: string): ResolvedTarget | undefined => {
  if (keyword === '$recursiveRef') {
    const anchored = search(root, (obj) => obj['$recursiveAnchor'] === true)
    return anchored ?? { value: root, pointer: [] }
  }

  if (isPointerFragment(fragment)) {
    const value = getByPointer(root, fragment)
    return value === undefined ? undefined : { value, pointer: pointerToPath(fragment) }
  }

  if (keyword === '$dynamicRef') {
    return (
      search(root, (obj) => obj['$dynamicAnchor'] === fragment) ?? search(root, (obj) => obj['$anchor'] === fragment)
    )
  }
  return search(root, (obj) => obj['$anchor'] === fragment || obj['$dynamicAnchor'] === fragment)
}
