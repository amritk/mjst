import { getByPointer, pointerToPath } from './get-by-pointer'
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

/** A fragment is a JSON Pointer when it is empty or begins with `/`; otherwise a plain-name anchor. */
const isPointerFragment = (fragment: string): boolean => fragment === '' || fragment.startsWith('/')

/** The resolved target of a reference: the node and the path to it within its document. */
export type ResolvedTarget = { value: unknown; pointer: JsonPath }

/**
 * Depth-first search for the first object in `root` satisfying `predicate`,
 * returning it with the path to it. `seen` guards against cyclic inputs. Used to
 * locate `$anchor`/`$dynamicAnchor`/`$recursiveAnchor` targets.
 */
const search = (root: unknown, predicate: (obj: Record<string, unknown>) => boolean): ResolvedTarget | undefined => {
  const seen = new Set<object>()
  const walk = (node: unknown, pointer: JsonPath): ResolvedTarget | undefined => {
    if (node === null || typeof node !== 'object' || seen.has(node)) return undefined
    seen.add(node)
    if (!Array.isArray(node) && predicate(node as Record<string, unknown>)) return { value: node, pointer }
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const found = walk(node[i], [...pointer, i])
        if (found) return found
      }
    } else {
      for (const key of Object.keys(node)) {
        const found = walk((node as Record<string, unknown>)[key], [...pointer, key])
        if (found) return found
      }
    }
    return undefined
  }
  return walk(root, [])
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
 * `root` rather than walking the dynamic scope. For one bundled document — what a
 * linter dereferences — there is exactly one anchor per name, so this agrees with
 * the full dynamic-scope algorithm. Nested `$id` base-URI re-scoping is not
 * modelled (the common bundled case does not rely on it).
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
