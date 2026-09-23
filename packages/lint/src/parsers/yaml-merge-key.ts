import {
  isAlias,
  isMap,
  isPair,
  isScalar,
  isSeq,
  keyText,
  type YamlMap,
  type YamlNode,
  type YamlPair,
} from '@amritk/yaml'

/**
 * True when a pair is a `<<` merge key, whose value folds into the parent map
 * instead of becoming a key of its own. The parser runs with `merge: true`, so
 * `toJS` never projects a `<<` key — which is why both the position lookup and
 * the non-finite scan route these pairs to their merge handling rather than
 * treating `<<` as a path segment.
 */
export const isMergePair = (pair: YamlPair): boolean => isScalar(pair.key) && pair.key.source === '<<'

/**
 * What one map holds, gathered the first time anything asks about it: the
 * explicit pairs' values grouped by key text (in source order, so duplicates
 * keep their order), the `<<` values in source order, and the answers already
 * worked out for merged keys and for the full key list.
 */
export type KeyTable = {
  explicit: Map<string, YamlNode[]>
  merges: (YamlNode | null)[]
  merged: Map<string, YamlNode | null>
  keys: string[] | undefined
}

/**
 * Answers "which node does `toJS` project this key of this map from?" for maps
 * that use `<<`, shared by the position lookup and the non-finite scan so both
 * agree with the data.
 *
 * The rule is `toJsValue`/`applyMerge` in `@amritk/yaml`: a map's object is
 * built pair by pair, an explicit key overwrites whatever is there (so the last
 * duplicate wins, and it beats a merged key wherever it is written), and a `<<`
 * pair copies in every key of its source's *finished* object that the map does
 * not hold yet (so an earlier merge, or an earlier item of a merge list, wins).
 * The source's object was itself built by the same rule first, which is the part
 * a walk over the source's pairs in order gets wrong: in `{<<: *b, a: 1}` the
 * nested merge is written first, but the source's own `a` is what it projects.
 * A merge source that is not a map or a list of maps (a scalar, a `!!set`, an
 * `!!omap`) projects to something with no own keys and contributes nothing.
 *
 * One quirk is kept from the eager position index this replaced: a key written
 * with no value (`key:`) has no node to point at, so it is treated as absent —
 * it neither answers nor shadows — rather than as the `null` `toJS` gives it.
 *
 * Answers are memoised per map and key. The same anchor merged into a thousand
 * maps, or a merge chain reached by a thousand aliases, is then scanned once,
 * not once per map per lookup. `meter.left` is decremented for every merge
 * source examined on a cache miss so a caller with a work budget can charge the
 * scanning to it; the scan always runs to completion, so a cached answer is
 * never a partial one.
 */
export const createMergeResolver = (meter: { left: number } = { left: Number.POSITIVE_INFINITY }) => {
  const tables = new Map<YamlMap, KeyTable>()

  const tableOf = (map: YamlMap): KeyTable => {
    const cached = tables.get(map)
    if (cached) return cached
    const table: KeyTable = { explicit: new Map(), merges: [], merged: new Map(), keys: undefined }
    for (const pair of map.items) {
      if (!isPair(pair)) continue
      if (isMergePair(pair)) {
        table.merges.push(pair.value)
        continue
      }
      // A valueless key has no node, so it cannot shadow the earlier duplicate
      // it follows or claim a key ahead of a merged one (see above).
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
   * Calls `visit` with every map a merge value brings in, in the order
   * `applyMerge` folds them: through an alias, and item by item through a list
   * (nested lists included). Stops, returning the answer, as soon as `visit`
   * returns something other than `null`.
   */
  const eachSource = <T>(node: YamlNode | null | undefined, visit: (source: YamlMap) => T | null): T | null => {
    meter.left--
    const target = node != null && isAlias(node) ? node.target : node
    if (target == null) return null
    if (isSeq(target)) {
      if (target.tag === 'omap') return null
      for (const item of target.items) {
        const found = eachSource(item, visit)
        if (found !== null) return found
      }
      return null
    }
    if (!isMap(target) || target.tag === 'set') return null
    return visit(target)
  }

  /** The node a key of `map` gets from its `<<` merges alone, or `null`. */
  const mergedValueOf = (map: YamlMap, key: string): YamlNode | null => {
    const table = tableOf(map)
    if (table.merges.length === 0) return null
    const cached = table.merged.get(key)
    if (cached !== undefined) return cached
    // Claimed before the scan so a merge that somehow reached back into this
    // map would read "no answer" instead of recursing. The parser leaves a
    // recursive alias without a target, so this is only a safety net.
    table.merged.set(key, null)
    let found: YamlNode | null = null
    for (const merge of table.merges) {
      found = eachSource(merge, (source) => projectedValueOf(source, key))
      if (found !== null) break
    }
    table.merged.set(key, found)
    return found
  }

  /** The node `toJS` projects `map[key]` from, or `null` when the key is absent. */
  const projectedValueOf = (map: YamlMap, key: string): YamlNode | null => {
    const explicit = tableOf(map).explicit.get(key)
    if (explicit) return explicit[explicit.length - 1] as YamlNode
    return mergedValueOf(map, key)
  }

  /**
   * Every key `toJS` gives `map`, in the order its object receives them —
   * explicit keys and the keys each `<<` brings in, interleaved as written.
   */
  const keysOf = (map: YamlMap): readonly string[] => {
    const table = tableOf(map)
    if (table.keys) return table.keys
    const keys: string[] = []
    table.keys = keys
    const seen = new Set<string>()
    const add = (key: string): void => {
      if (seen.has(key)) return
      seen.add(key)
      keys.push(key)
    }
    for (const pair of map.items) {
      if (!isPair(pair)) continue
      if (isMergePair(pair)) {
        eachSource(pair.value, (source) => {
          for (const key of keysOf(source)) add(key)
          return null
        })
      } else if (pair.value != null) {
        add(keyText(pair.key))
      }
    }
    return keys
  }

  return { tableOf, projectedValueOf, mergedValueOf, keysOf }
}

/** The shared merge-key resolver {@link createMergeResolver} builds. */
export type MergeResolver = ReturnType<typeof createMergeResolver>
