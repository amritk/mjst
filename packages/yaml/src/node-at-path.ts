import { isAlias, isMap, isSeq } from './guards'
import { keyText } from './parse-document'
import type { YamlMap, YamlNode, YamlPair } from './types'

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
 * Smallest mapping {@link findPair} indexes rather than scans. Below it a linear
 * scan is a handful of string compares and allocates nothing, which beats
 * building (and holding) a `Map` for the small mappings that make up nearly
 * every document; above it a scan per path segment is what made resolving every
 * path of a large spec quadratic in its widest mappings — OpenAI's public
 * OpenAPI document has one of 959 keys.
 */
const INDEX_MIN_PAIRS = 16

/**
 * A wide mapping's pairs keyed by {@link keyText}, and how many items the
 * mapping had when the index was built.
 */
type KeyIndex = { size: number; pairs: Map<string, YamlPair> }

/**
 * Key indexes for the wide mappings {@link nodeAtPath} has walked through, built
 * on the first lookup and weakly held so they go away with the tree. Module level
 * because the node types are plain data the index must not be written onto: a
 * caller serialising or deep-comparing a tree would otherwise meet it.
 */
const keyIndexes = new WeakMap<YamlMap, KeyIndex>()

/**
 * Builds {@link KeyIndex} for a mapping. Pairs are inserted in order, so a
 * duplicated key ends up holding the *last* pair written — the one `toJS()`
 * keeps, and the one the back-to-front scan finds first.
 */
const buildKeyIndex = (map: YamlMap): KeyIndex => {
  const pairs = new Map<string, YamlPair>()
  for (const pair of map.items) if (pair !== undefined) pairs.set(keyText(pair.key), pair)
  const index = { size: map.items.length, pairs }
  keyIndexes.set(map, index)
  return index
}

/**
 * Finds the pair of `map` whose {@link keyText} is `key`, taking the last one
 * when the key is duplicated.
 *
 * The index trusts that a mapping it has seen is not edited in place, with one
 * cheap exception: it is rebuilt whenever `items.length` differs from when it
 * was built, so pairs pushed, popped or spliced in by a caller are always seen.
 * Replacing a pair in place, or rewriting a key node's value, is not detected —
 * a caller that edits a tree like that after walking it has to walk a copy.
 */
const findPair = (map: YamlMap, key: string): YamlPair | undefined => {
  const items = map.items
  if (items.length < INDEX_MIN_PAIRS) {
    // Scanned back to front so a duplicated key resolves to the pair that
    // *won*. `toJS()` assigns each pair in order, so the last one written is
    // the value the projection holds — the same rule `JSON.parse` follows, and
    // what `uniqueKeys: false` documents. Taking the first match instead
    // pointed a diagnostic at the shadowed node: the span of a value the
    // caller is not looking at.
    for (let i = items.length - 1; i >= 0; i--) {
      const pair = items[i]
      if (pair !== undefined && keyText(pair.key) === key) return pair
    }
    return undefined
  }
  let index = keyIndexes.get(map)
  if (index === undefined || index.size !== items.length) index = buildKeyIndex(map)
  return index.pairs.get(key)
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
      next = findPair(node, String(segment))?.value
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
