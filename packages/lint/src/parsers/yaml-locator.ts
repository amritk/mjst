import { isAlias, isMap, isSeq, type YamlDocument, type YamlNode } from '@amritk/yaml'

import type { LineMap } from './lines'
import type { ILocation, JsonPath } from './types'
import { createMergeResolver } from './yaml-merge-key'

/**
 * How much work one lookup may do across all its segments: every candidate it
 * steps through, every child it collects, and every merge source it scans. A
 * lookup is O(depth) for any document a person writes — each segment names one
 * child — but duplicate keys can multiply the candidates (see
 * {@link createYamlLocator}), so a few lines of hostile YAML could otherwise make
 * one lookup slow. This replaces the whole-stream node budget the eager index
 * used to carry for the same "billion laughs" shape. A lookup that runs out
 * starts over with a plain descent that follows only the value `toJS` keeps at
 * each step: O(depth), and it lands on the node the data holds, but without the
 * eager index's reach into shadowed duplicates.
 */
const MAX_LOOKUP_VISITS = 100_000

/**
 * Knobs for tests. `maxVisits` replaces {@link MAX_LOOKUP_VISITS} so the budget
 * fallback can be reached with a small document, and `stats.visits` accumulates
 * the work every lookup charged, so a test can bound a lookup's cost without
 * timing it.
 */
export type YamlLocatorOptions = {
  maxVisits?: number
  stats?: { visits: number }
}

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
 * What a candidate contributes by: the node an alias names, or the node itself.
 * Two aliases of the same anchor contribute exactly the same children, which is
 * what lets {@link dedupeCandidates} fold them.
 */
const identityOf = (node: YamlNode): YamlNode => (isAlias(node) ? (node.target ?? node) : node)

/**
 * Drops every candidate that is neither the first nor the last occurrence of
 * its node, which leaves every answer of the lookup unchanged.
 *
 * The answer at any depth is the last candidate, and the last occurrence stays.
 * A candidate's children depend only on its node, and a merged key only counts
 * until the first candidate that contributes anything — which is always a first
 * occurrence, since an earlier copy would have contributed the same. A middle
 * occurrence therefore adds only a repeat of explicit children that the first
 * and last occurrences add too, and those repeats are middle occurrences one
 * level down, so dropping them there changes nothing either.
 *
 * Without this, duplicate keys reached through aliases multiply the candidates
 * at every level (`r: {k: *A, k: *A, …}` with `A: {k: *E, k: *E, …}`); with it,
 * a level holds at most two candidates per distinct node.
 */
const dedupeCandidates = (nodes: YamlNode[]): YamlNode[] => {
  const last = new Map<YamlNode, number>()
  for (let i = 0; i < nodes.length; i++) last.set(identityOf(nodes[i] as YamlNode), i)
  if (last.size === nodes.length) return nodes
  const kept: YamlNode[] = []
  const seen = new Set<YamlNode>()
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i] as YamlNode
    const identity = identityOf(node)
    if (!seen.has(identity)) {
      seen.add(identity)
      kept.push(node)
    } else if (last.get(identity) === i) {
      kept.push(node)
    }
  }
  return kept
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
 * The answers are the eager index's, including its quirks, because rulesets and
 * fixers were written against them:
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
 * - A key brought in by `<<` resolves to the node `toJS` takes it from (see
 *   {@link createMergeResolver}): explicit keys win over merged ones, an earlier
 *   merge (or an earlier item of a merge list) wins over a later one, and a
 *   merge source contributes the keys of its own projection — its explicit keys
 *   ahead of anything *it* merges. A merged key only lands on a path nothing
 *   else claimed. The eager index differed here: it walked a merge source's
 *   pairs in order, so a nested `<<` written first claimed keys the source
 *   itself overrides, and a finding landed on a value the data does not hold.
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
  options: YamlLocatorOptions = {},
): ((path: JsonPath, closest?: boolean) => ILocation | undefined) => {
  const multiDocument = docs.length > 1
  const maxVisits = options.maxVisits ?? MAX_LOOKUP_VISITS
  /** The current lookup's remaining budget, shared with the merge resolver. */
  const budget = { left: maxVisits }
  const merges = createMergeResolver(budget)

  /**
   * The nodes the eager walk would have visited at `path + [segment]`, in visit
   * order, given the ones it visited at `path`, or `undefined` once the budget
   * is spent. A merge contributes only while the path is still unclaimed: the
   * eager walk checked the index before walking a merged key, and every earlier
   * candidate had already written it.
   */
  const childrenOf = (visits: readonly YamlNode[], segment: string): YamlNode[] | undefined => {
    const children: YamlNode[] = []
    for (const visit of visits) {
      if (budget.left-- <= 0) return undefined
      const node = isAlias(visit) ? visit.target : visit
      if (node == null) continue
      if (isMap(node)) {
        const explicit = merges.tableOf(node).explicit.get(segment)
        if (explicit) {
          budget.left -= explicit.length
          for (const value of explicit) children.push(value)
        } else if (children.length === 0) {
          const merged = merges.mergedValueOf(node, segment)
          if (merged) children.push(merged)
        }
      } else if (isSeq(node)) {
        const index = seqIndex(segment, node.items.length)
        const item = index === -1 ? undefined : node.items[index]
        if (item !== undefined) children.push(item)
      }
    }
    if (budget.left <= 0) return undefined
    return children.length > 1 ? dedupeCandidates(children) : children
  }

  /**
   * The fallback for a lookup that ran out of budget: follow the one value
   * `toJS` keeps at each segment — the last explicit duplicate, else the merged
   * key — the way `nodeAtPath` does. It cannot multiply, so it needs no budget,
   * and it lands on the node the data holds.
   */
  const descend = (root: YamlNode, path: JsonPath, depth: number, closest: boolean): YamlNode | undefined => {
    let node = root
    for (; depth < path.length; depth++) {
      const target = isAlias(node) ? node.target : node
      const segment = String(path[depth])
      let child: YamlNode | null | undefined
      if (target != null && isMap(target)) child = merges.projectedValueOf(target, segment)
      else if (target != null && isSeq(target)) child = target.items[seqIndex(segment, target.items.length)]
      if (child == null) return closest ? node : undefined
      node = child
    }
    return node
  }

  /** The node at `path`, or `undefined`, per the rules above. */
  const locate = (path: JsonPath, closest: boolean): YamlNode | undefined => {
    let root: YamlNode | null
    let depth = 0
    if (multiDocument) {
      // The stream itself was never indexed — only each document under `[i]`.
      const first = path[0]
      if (first === undefined) return undefined
      const index = seqIndex(String(first), docs.length)
      root = index === -1 ? null : (docs[index]?.contents ?? null)
      depth = 1
    } else {
      root = docs[0]?.contents ?? null
    }
    if (root == null) return undefined

    const start = depth
    let visits: YamlNode[] = [root]
    for (; depth < path.length; depth++) {
      const children = childrenOf(visits, String(path[depth]))
      if (children === undefined) return descend(root, path, start, closest)
      if (children.length === 0) {
        if (!closest) return undefined
        break
      }
      visits = children
    }
    return visits[visits.length - 1]
  }

  return (path, closest = false) => {
    budget.left = maxVisits
    const node = locate(path, closest)
    if (options.stats) options.stats.visits += maxVisits - budget.left
    if (node === undefined) return undefined
    return { range: { start: lineMap.positionAt(node.start), end: lineMap.positionAt(node.end) } }
  }
}
