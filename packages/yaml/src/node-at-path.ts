import { isAlias, isMap, isSeq } from './guards'
import { keyText } from './parse-document'
import type { YamlNode } from './types'

/** A path into a document, e.g. `['paths', '/pets', 'get']` or `['tags', 0]`. */
export type NodePath = readonly (string | number)[]

/**
 * How many `*alias` hops to follow before giving up. An alias can only name an
 * anchor declared earlier in the document, so a chain always walks backwards and
 * terminates — but `nodeAtPath` takes any tree it is handed, including one a
 * caller built, so the bound keeps a hand-made cycle from hanging the walk.
 */
const MAX_ALIAS_HOPS = 100

/**
 * Follows an alias to the node it names, so the walk can descend into a
 * collection that was written once and referenced elsewhere. A dangling alias
 * (no matching anchor) resolves to `undefined`, which ends the walk exactly as a
 * missing key does.
 */
const resolveAlias = (node: YamlNode): YamlNode | undefined => {
  let current: YamlNode | undefined = node
  for (let hops = 0; current !== undefined && isAlias(current); hops++) {
    if (hops >= MAX_ALIAS_HOPS) return undefined
    current = current.target
  }
  return current
}

/**
 * Walks a node tree to the node addressed by `path`, returning it (with its
 * exact `range`) or `undefined` if the path does not exist.
 *
 * When `closest` is true and the full path is missing, it returns the deepest
 * ancestor that does exist — exactly what a linter wants so a diagnostic can
 * still point at the nearest real source span instead of nowhere. Keys are
 * compared as strings so a numeric path segment matches a stringified map key —
 * using the parser's own {@link keyText}, so the strings a path is written in
 * are exactly the ones `toJS()` produced. Anything less means a caller that
 * walks the projected data cannot then locate the node it came from.
 *
 * An `*alias` on the way down is followed to the collection it names, because
 * `toJS()` expands it: a path like `['schemas', 'Loc', 'required', 0]` addresses
 * a real value in the projection whenever `required: *ref` points at a sequence,
 * and without the hop every path underneath an aliased collection was
 * unreachable — `undefined`, or (with `closest`) the wrong ancestor's span. Real
 * specs lean on this; OpenAI's public OpenAPI document alone has two. A path
 * that *ends* on the alias still returns the alias node itself, so a diagnostic
 * points at the `*ref` the document wrote rather than at the distant anchor.
 */
export const nodeAtPath = (root: YamlNode | null, path: NodePath, closest = false): YamlNode | undefined => {
  if (root === null) return undefined
  let node: YamlNode = root
  let matched: YamlNode = root

  for (const segment of path) {
    if (isAlias(node)) {
      const target = resolveAlias(node)
      // A dangling alias is a dead end like a missing key is, and it has to end
      // the walk the same way. Breaking out instead returned `undefined` even
      // under `closest` — dropping the one span a caller reporting an
      // unresolved alias most wants, the `*ref` the document actually wrote.
      if (target === undefined) return closest ? matched : undefined
      node = target
    }
    let next: YamlNode | null | undefined

    if (isMap(node)) {
      const key = String(segment)
      // Scanned back to front so a duplicated key resolves to the pair that
      // *won*. `toJS()` assigns each pair in order, so the last one written is
      // the value the projection holds — the same rule `JSON.parse` follows, and
      // what `uniqueKeys: false` documents. Taking the first match instead
      // pointed a diagnostic at the shadowed node: the span of a value the
      // caller is not looking at.
      for (let i = node.items.length - 1; i >= 0; i--) {
        const pair = node.items[i]
        if (pair !== undefined && keyText(pair.key) === key) {
          next = pair.value
          break
        }
      }
    } else if (isSeq(node)) {
      const index = typeof segment === 'number' ? segment : Number(segment)
      next = Number.isInteger(index) ? node.items[index] : undefined
    }

    if (next == null) return closest ? matched : undefined
    node = next
    matched = next
  }

  return node
}
