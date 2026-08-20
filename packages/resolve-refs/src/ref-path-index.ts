import { childRole, type NodeRole } from './child-role'
import { DEFAULT_MAX_DEPTH } from './max-depth'
import { REF_KEYWORDS, type RefKeyword } from './reference'
import type { JsonPath, ResolveError } from './types'

/** The key a reference is indexed under: the keyword it uses and its value. */
const refKey = (keyword: string, ref: string): string => `${keyword} ${ref}`

/**
 * Indexes every reference in `root` by keyword and value, mapping each to where
 * it was written. First occurrence wins, so a reference used in several places
 * reports at the first one a reader would find.
 *
 * Role-aware, like every other walk in the package: a `$ref` key inside an
 * `enum` member is part of that value, not a reference (see `child-role.ts`).
 */
const buildIndex = (root: unknown, maxDepth: number): Map<string, JsonPath> => {
  const index = new Map<string, JsonPath>()
  // Iterative and cycle-guarded for the same reasons `detach` is: a custom
  // `parse` can hand back a cyclic document, and the documents most likely to
  // carry a broken reference are the awkward ones.
  const seen = new Set<object>()
  const stack: { node: unknown; path: JsonPath; role: NodeRole }[] = [{ node: root, path: [], role: 'schema' }]
  while (stack.length > 0) {
    const frame = stack.pop()
    if (frame === undefined) break
    const { node, path, role } = frame
    if (node === null || typeof node !== 'object' || role === 'value') continue
    if (path.length > maxDepth || seen.has(node)) continue
    seen.add(node)
    if (Array.isArray(node)) {
      // Reversed so the LIFO stack pops them in document order, which is what
      // makes "the first one" mean the first one a reader would find.
      for (let at = node.length - 1; at >= 0; at--) {
        stack.push({ node: node[at], path: [...path, at], role: childRole(role, at) })
      }
      continue
    }
    const obj = node as Record<string, unknown>
    const keys = Object.keys(obj)
    if (role !== 'schemaMap') {
      for (const keyword of REF_KEYWORDS) {
        const value = obj[keyword]
        if (typeof value !== 'string') continue
        const entry = refKey(keyword, value)
        if (!index.has(entry)) index.set(entry, [...path, keyword])
      }
    }
    for (let at = keys.length - 1; at >= 0; at--) {
      const key = keys[at] as string
      stack.push({ node: obj[key], path: [...path, key], role: childRole(role, key) })
    }
  }
  return index
}

/**
 * A lookup from a reference to where it was written in `root`, or `[]` when it
 * was not written there at all.
 *
 * Every {@link ResolveError} carries the path to the reference that failed, and
 * every one of them used to be either empty or — worse — the path to the target
 * the reference *should* have found, which by definition is a node the document
 * does not contain. A consumer anchoring a diagnostic on it (the CLI does) sent
 * the reader to the top of the file, or to whichever node sat nearest the hole.
 *
 * The index is built on the first lookup and never on a resolve that has
 * nothing to report, which is what keeps this off the happy path — and building
 * it *once* is what keeps a document full of broken references linear rather
 * than paying a fresh document walk per error.
 *
 * The paths are paths **in `root`**, which is what a consumer can map back to a
 * position. A reference living in some other document is simply not indexed,
 * and an empty path says "no position" the way it always has.
 */
export const refPathIndex = (
  root: unknown,
  maxDepth: number = DEFAULT_MAX_DEPTH,
): ((keyword: RefKeyword, ref: string) => JsonPath) => {
  let index: Map<string, JsonPath> | undefined
  return (keyword, ref) => {
    index ??= buildIndex(root, maxDepth)
    return index.get(refKey(keyword, ref)) ?? []
  }
}
