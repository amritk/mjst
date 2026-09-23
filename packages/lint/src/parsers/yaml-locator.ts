import { isAlias, isMap, isPair, isSeq, keyText, type YamlDocument, type YamlMap, type YamlNode } from '@amritk/yaml'

import type { LineMap } from './lines'
import type { ILocation, JsonPath } from './types'
import { isMergePair } from './yaml-merge-key'

/**
 * The pieces of a map a lookup needs, gathered once per map on the first lookup
 * that passes through it: the explicit pairs' values grouped by key text (in
 * source order, so duplicates keep their order), and the `<<` values to fall
 * back to when no explicit key answers.
 */
type KeyTable = {
  explicit: Map<string, YamlNode[]>
  merges: (YamlNode | null)[]
}

/**
 * How many candidate nodes one lookup may collect across all its segments. A
 * lookup is O(depth) for any document a person writes — each segment names one
 * child — but duplicate keys reached through aliases can multiply the candidates
 * at every level (see {@link createYamlLocator}), so a few lines of hostile YAML
 * could otherwise make one lookup exponential. This replaces the whole-stream
 * node budget the eager index used to carry for the same "billion laughs" shape;
 * a lookup that runs out simply resolves with what it has.
 */
const MAX_LOOKUP_VISITS = 100_000

/**
 * The canonical sequence index a path segment names, or `-1`. A segment is
 * matched by its text, so `0` and `'0'` name the same item, but only the
 * canonical spelling does — `'01'`, `'1e0'`, and `' 1'` are not indices, just as
 * they were not keys of the eager index this replaced.
 */
const seqIndex = (segment: string, length: number): number => {
  const index = Number(segment)
  return Number.isInteger(index) && index >= 0 && index < length && String(index) === segment ? index : -1
}

/**
 * Builds the path-to-position lookup for a parsed YAML stream, resolving each
 * path on demand instead of indexing every node up front.
 *
 * Indexing eagerly meant copying a path array, building a string key, and
 * running two line-map searches for every node of the document — about two
 * thirds of lint's parse time on a large spec — while a lint run only ever asks
 * for the handful of paths that carry findings. A lookup now walks the tree from
 * the root along the path, which is O(depth).
 *
 * The answers are exactly the eager index's, including its quirks, because
 * rulesets and fixers were written against them:
 *
 * - Segments match by text: `0` and `'0'` both name item 0 of a sequence and a
 *   `"0"` key of a map, the way the index's string keys did.
 * - An alias keeps its own range, and a path beneath it descends into the
 *   anchored node.
 * - A duplicated key resolves to the last occurrence — the index's last write.
 *   Because the index was keyed by path text, *every* occurrence of the key
 *   contributed its subtree, so a path that exists only under an earlier
 *   duplicate still resolves there. That is why a lookup tracks a list of
 *   candidate nodes per segment rather than a single node: the answer is the
 *   last candidate at the full path.
 * - A key brought in by `<<` resolves into the merge source, explicit keys win
 *   over merged ones, an earlier merge (or an earlier item of a merge list) wins
 *   over a later one, and a merged key only lands on a path nothing else claimed.
 * - A key written with no value (`key:`) has no position of its own, so the key
 *   is absent and `closest` falls back past it.
 * - In a multi-document stream every path starts with the document index, and
 *   the stream itself (the empty path) has no position.
 *
 * `closest` returns the deepest prefix that resolves, which is what popping
 * segments off the path until the index had it found: every prefix of an indexed
 * path was itself indexed.
 */
export const createYamlLocator = (
  docs: readonly YamlDocument[],
  lineMap: LineMap,
): ((path: JsonPath, closest?: boolean) => ILocation | undefined) => {
  const multiDocument = docs.length > 1
  const tables = new Map<YamlMap, KeyTable>()

  const tableOf = (map: YamlMap): KeyTable => {
    const cached = tables.get(map)
    if (cached) return cached
    const table: KeyTable = { explicit: new Map(), merges: [] }
    for (const pair of map.items) {
      if (!isPair(pair)) continue
      if (isMergePair(pair)) {
        table.merges.push(pair.value)
        continue
      }
      // A valueless key never made it into the index, so it cannot shadow the
      // earlier duplicate it follows or claim a path ahead of a merged key.
      if (pair.value == null) continue
      const key = keyText(pair.key)
      const values = table.explicit.get(key)
      if (values) values.push(pair.value)
      else table.explicit.set(key, [pair.value])
    }
    tables.set(map, table)
    return table
  }

  /**
   * Finds the value a merge source (reached through the `<<` value) provides for
   * `key`: the first match in source order, with a nested `<<` searched where it
   * sits among the source's own keys — the order the eager walk claimed paths
   * in. `searched` holds sources that already came up empty during this lookup,
   * so a merge list naming the same anchor twice, or merges of merges of the
   * same base, cannot grow the search past the size of the document.
   */
  const findMerged = (node: YamlNode | null | undefined, key: string, searched: Set<YamlNode>): YamlNode | null => {
    const target = node != null && isAlias(node) ? node.target : node
    if (target == null || searched.has(target)) return null
    searched.add(target)
    if (isSeq(target)) {
      for (const item of target.items) {
        const found = findMerged(item, key, searched)
        if (found) return found
      }
      return null
    }
    if (!isMap(target)) return null
    for (const pair of target.items) {
      if (!isPair(pair)) continue
      if (isMergePair(pair)) {
        const found = findMerged(pair.value, key, searched)
        if (found) return found
        continue
      }
      if (pair.value != null && keyText(pair.key) === key) return pair.value
    }
    return null
  }

  /**
   * The nodes the eager walk would have visited at `path + [segment]`, in visit
   * order, given the ones it visited at `path`. A merge contributes only while
   * the path is still unclaimed: the eager walk checked the index before
   * walking a merged key, and every earlier candidate had already written it.
   */
  const childrenOf = (visits: readonly YamlNode[], segment: string, budget: { left: number }): YamlNode[] => {
    const children: YamlNode[] = []
    for (const visit of visits) {
      const node = isAlias(visit) ? visit.target : visit
      if (node == null) continue
      if (isMap(node)) {
        const table = tableOf(node)
        const explicit = table.explicit.get(segment)
        if (explicit) {
          for (const value of explicit) {
            if (budget.left-- <= 0) return children
            children.push(value)
          }
        }
        if (children.length === 0 && table.merges.length > 0) {
          const searched = new Set<YamlNode>()
          for (const merge of table.merges) {
            const found = findMerged(merge, segment, searched)
            if (found) {
              children.push(found)
              break
            }
          }
        }
      } else if (isSeq(node)) {
        const index = seqIndex(segment, node.items.length)
        const item = index === -1 ? undefined : node.items[index]
        if (item !== undefined) {
          if (budget.left-- <= 0) return children
          children.push(item)
        }
      }
    }
    return children
  }

  return (path, closest = false) => {
    let visits: YamlNode[]
    let depth = 0
    if (multiDocument) {
      // The stream itself was never indexed — only each document under `[i]`.
      const first = path[0]
      if (first === undefined) return undefined
      const index = seqIndex(String(first), docs.length)
      const contents = index === -1 ? null : (docs[index]?.contents ?? null)
      visits = contents ? [contents] : []
      depth = 1
    } else {
      const contents = docs[0]?.contents ?? null
      visits = contents ? [contents] : []
    }
    if (visits.length === 0) return undefined

    const budget = { left: MAX_LOOKUP_VISITS }
    for (; depth < path.length; depth++) {
      const children = childrenOf(visits, String(path[depth]), budget)
      if (children.length === 0) {
        if (!closest) return undefined
        break
      }
      visits = children
    }
    const node = visits[visits.length - 1] as YamlNode
    return { range: { start: lineMap.positionAt(node.start), end: lineMap.positionAt(node.end) } }
  }
}
