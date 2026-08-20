import { childRole, type NodeRole } from './child-role'
import { DEFAULT_MAX_DEPTH } from './max-depth'
import type { RefKeyword } from './reference'
import type { JsonPath, ResolveError } from './types'

/**
 * Where in `root` the first `keyword: ref` was written, or `[]` when it was not
 * written there at all.
 *
 * Every {@link ResolveError} carries the path to the reference that failed, and
 * every one of them used to be either empty or — worse — the path to the target
 * the reference *should* have found, which by definition is a node the document
 * does not contain. A consumer anchoring a diagnostic on it (the CLI does) sent
 * the reader to the top of the file, or to whichever node sat nearest the hole.
 *
 * Searching after the fact rather than threading a path through the resolve
 * walk keeps the cost where it belongs: a document that resolves cleanly pays
 * nothing, and the resolvers report each unique failing reference once, so the
 * search runs once per broken ref.
 *
 * The path returned is a path **in `root`**, which is what a consumer can map
 * back to a position. A reference that lives in some other document — or inside
 * a `$ref` target rather than in the document as written — is simply not found
 * here, and an empty path says "no position" exactly as it did before.
 *
 * Role-aware, like every other walk in the package: a `$ref` key inside an
 * `enum` member is part of that value, so it is not the reference we are
 * looking for (see `child-role.ts`).
 */
export const findRefPath = (
  root: unknown,
  keyword: RefKeyword,
  ref: string,
  maxDepth: number = DEFAULT_MAX_DEPTH,
): JsonPath => {
  // Iterative and cycle-guarded for the same reasons `detach` is: a custom
  // `parse` can hand back a cyclic document, and the documents most likely to
  // carry a broken ref are the awkward ones.
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
      for (let index = node.length - 1; index >= 0; index--) {
        stack.push({ node: node[index], path: [...path, index], role: childRole(role, index) })
      }
      continue
    }
    const obj = node as Record<string, unknown>
    if (role !== 'schemaMap' && obj[keyword] === ref) return [...path, keyword]
    const keys = Object.keys(obj)
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index] as string
      stack.push({ node: obj[key], path: [...path, key], role: childRole(role, key) })
    }
  }
  return []
}
