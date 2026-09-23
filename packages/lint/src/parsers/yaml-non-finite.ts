import { isAlias, isMap, isPair, isScalar, isSeq, keyText, type YamlNode, type YamlScalar } from '@amritk/yaml'

import { isMergePair } from './yaml-merge-key'

/**
 * Calls `report` once for every scalar value in a document that projects to a
 * non-finite number — `.nan`, `.inf`, `-.inf` under the core schema — in the
 * order a depth-first walk of the data reaches them.
 *
 * `JSON.stringify` silently rewrites those values to `null`, which is what the
 * `incompatibleValues` option exists to catch. This used to ride along with the
 * eager position index; the index is on demand now, so the check gets its own
 * walk, and only when the option is on.
 *
 * The walk covers what the projection can hold: map values, sequence items, the
 * collection an alias names, and the keys a `<<` merge brings in — skipping a
 * merged key an explicit key (or an earlier merge) already claimed, since
 * `toJS` drops that value. Keys themselves are not checked; they project to
 * strings. A collection is walked once however many aliases reach it and a
 * value is reported once however many merges bring it in, so this is linear in
 * the document even for the alias-heavy "billion laughs" shape, and a value
 * written once is reported once.
 */
export const reportNonFinite = (root: YamlNode | null, report: (node: YamlScalar) => void): void => {
  /** Collections already walked, and non-finite scalars already reported. */
  const seen = new Set<YamlNode>()

  /**
   * Walks the keys a merge source contributes to a map, claiming each one in
   * `claimed` so a later merge cannot bring the same key in again. `sources`
   * holds the merge sources this map already searched: naming one twice (or
   * reaching it through merges of merges) contributes nothing new, because every
   * key it has is claimed by then.
   */
  const visitMerge = (node: YamlNode | null | undefined, claimed: Set<string>, sources: Set<YamlNode>): void => {
    const target = node != null && isAlias(node) ? node.target : node
    if (target == null || sources.has(target)) return
    sources.add(target)
    if (isSeq(target)) {
      for (const item of target.items) visitMerge(item, claimed, sources)
      return
    }
    if (!isMap(target)) return
    for (const pair of target.items) {
      if (!isPair(pair)) continue
      if (isMergePair(pair)) {
        visitMerge(pair.value, claimed, sources)
        continue
      }
      if (pair.value == null) continue
      const key = keyText(pair.key)
      if (claimed.has(key)) continue
      claimed.add(key)
      visit(pair.value)
    }
  }

  const visit = (node: YamlNode | null | undefined): void => {
    if (node == null) return
    if (isScalar(node)) {
      const value = node.value
      if (typeof value === 'number' && !Number.isFinite(value) && !seen.has(node)) {
        seen.add(node)
        report(node)
      }
      return
    }
    // An alias to a scalar has no value of its own to check here: the scalar is
    // checked where it was written.
    const target = isAlias(node) ? node.target : node
    if (target == null || seen.has(target)) return
    if (isSeq(target)) {
      seen.add(target)
      for (const item of target.items) visit(item)
      return
    }
    if (!isMap(target)) return
    seen.add(target)
    let hasMerge = false
    for (const pair of target.items) {
      if (!isPair(pair)) continue
      if (isMergePair(pair)) hasMerge = true
      else visit(pair.value)
    }
    if (!hasMerge) return
    // Merged keys fill only the keys the explicit ones above left open. Key text
    // is rendered only for maps that merge, so a document without `<<` pays
    // nothing for it.
    const claimed = new Set<string>()
    for (const pair of target.items) {
      if (isPair(pair) && !isMergePair(pair) && pair.value != null) claimed.add(keyText(pair.key))
    }
    const sources = new Set<YamlNode>()
    for (const pair of target.items) {
      if (isPair(pair) && isMergePair(pair)) visitMerge(pair.value, claimed, sources)
    }
  }

  visit(root)
}
