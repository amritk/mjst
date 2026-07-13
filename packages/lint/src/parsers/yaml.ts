import { isAlias, isMap, isPair, isScalar, isSeq, parseDocument, type YamlNode, type YamlPair } from '@amritk/yaml'

import { createLineMap } from './lines'
import {
  DiagnosticSeverity,
  type IDiagnostic,
  type ILocation,
  type IParseResult,
  type IParserOptions,
  type IRange,
  type JsonPath,
} from './types'

/**
 * Encodes a path into a lookup key. Each segment is tagged by kind (`.` for a
 * key, `[]` for an index) so distinct paths cannot collide: a plain `join` turns
 * a `null` map key into `''` (colliding with the root path `[]`) and cannot tell
 * the numeric index `0` from the string key `"0"`. The tags keep them apart.
 */
const pathKey = (path: JsonPath): string =>
  path.map((segment) => (typeof segment === 'number' ? `[${segment}]` : `.${segment}`)).join('')

/**
 * Canonically serializes a complex (map/seq) mapping key into a stable, distinct
 * segment. `toJS`'s `keyText` collapses every complex key to `''`, so two
 * distinct complex keys (and their whole value subtrees) would share one index
 * slot and clobber each other. A structural serialization keeps them apart:
 * `[a,b]` for a sequence key, `{k:v}` for a mapping key, recursively. Strings are
 * quoted so a scalar member can't be confused with structure, and aliases render
 * as `*name` (never expanded, so this stays bounded regardless of the anchor).
 */
const serializeComplexKey = (node: YamlNode): string => {
  if (isSeq(node)) return `[${node.items.map(serializeComplexKey).join(',')}]`
  if (isMap(node)) {
    return `{${node.items
      .filter(isPair)
      .map((pair) => `${serializeComplexKey(pair.key)}:${pair.value ? serializeComplexKey(pair.value) : 'null'}`)
      .join(',')}}`
  }
  if (isAlias(node)) return `*${node.source}`
  const v = node.value
  return typeof v === 'string' ? JSON.stringify(v) : v === null ? 'null' : String(v)
}

/**
 * Stringifies a mapping key into an index segment. Scalar, null, and alias keys
 * match `toJS`'s `keyText` (`null`, the `String()` form, `*name`) so scalar-keyed
 * paths line up with the projected data. Complex (map/seq) keys — which `toJS`
 * cannot address individually — get a canonical structural serialization instead
 * of collapsing to `''`, so distinct complex keys occupy distinct index slots.
 */
const keyToString = (key: YamlNode): string => {
  if (isScalar(key)) {
    const v = key.value
    return typeof v === 'string' ? v : v === null ? 'null' : String(v)
  }
  if (isAlias(key)) return `*${key.source}`
  return serializeComplexKey(key)
}

/**
 * Parses YAML (a JSON superset, so this handles both) into data plus a source
 * map, surfacing duplicate-key and incompatible-value diagnostics per `options`.
 */
export const parseYaml = <T = unknown>(source: string, options: IParserOptions = {}): IParseResult<T> => {
  const lineMap = createLineMap(source)
  const duplicateKeys = options.duplicateKeys
  const dedupe = duplicateKeys === 'off' || duplicateKeys === false
  // A configured severity (Warning/Information/Hint) still detects duplicates; we
  // just re-map the reported severity below. Only `off`/`false` turns detection off.
  const dupSeverity = typeof duplicateKeys === 'number' ? duplicateKeys : DiagnosticSeverity.Error
  const doc = parseDocument(source, { uniqueKeys: !dedupe })
  const index = new Map<string, IRange>()

  const rangeOf = (node: YamlNode): IRange => ({
    start: lineMap.positionAt(node.start),
    end: lineMap.positionAt(node.end),
  })

  // Aliases are re-expanded into every path that reaches them, so nested aliases
  // (the "billion laughs" shape) can fan out super-linearly. Bound the total
  // nodes walked; on exhaustion we stop extending the index rather than throw —
  // untouched paths simply fall back to the closest indexed ancestor.
  let budget = Math.max(100_000, source.length * 100)

  /** True when a pair is a `<<` merge key, whose value folds into the parent map. */
  const isMergePair = (pair: YamlPair): boolean => isScalar(pair.key) && pair.key.source === '<<'

  /**
   * Indexes the keys of a merged map (or list of maps, reached through the `<<`
   * value) at the parent `path`. A merged key is skipped when the path is already
   * occupied — by an explicit key or an earlier merge — mirroring `toJS`, where
   * explicit keys and earlier merges win over later ones.
   */
  const walkMerge = (node: YamlNode | null | undefined, path: JsonPath): void => {
    const target = node != null && isAlias(node) ? node.target : node
    if (target == null) return
    if (isSeq(target)) {
      for (const item of target.items) walkMerge(item, path)
      return
    }
    if (!isMap(target)) return
    for (const item of target.items) {
      if (!isPair(item)) continue
      if (isMergePair(item)) {
        walkMerge(item.value, path)
        continue
      }
      const childPath = [...path, keyToString(item.key)]
      if (!index.has(pathKey(childPath))) walk(item.value, childPath)
    }
  }

  const walk = (node: YamlNode | null | undefined, path: JsonPath): void => {
    if (node == null || budget-- <= 0) return
    index.set(pathKey(path), rangeOf(node))

    // Follow an alias to its anchor definition so paths reachable only through the
    // alias resolve to the anchored node (the alias itself keeps the range set
    // above); an unresolved alias has no target and simply stops here.
    const target = isAlias(node) ? node.target : node
    if (target == null) return

    if (isMap(target)) {
      const merges: (YamlNode | null)[] = []
      for (const item of target.items) {
        if (!isPair(item)) continue
        if (isMergePair(item)) {
          merges.push(item.value)
          continue
        }
        walk(item.value, [...path, keyToString(item.key)])
      }
      // Merged keys fill positions the explicit keys above did not claim.
      for (const merge of merges) walkMerge(merge, path)
    } else if (isSeq(target)) {
      target.items.forEach((item, i) => {
        walk(item, [...path, i])
      })
    }
  }

  walk(doc.contents, [])

  const data = doc.toJS() as T

  const diagnostics: IDiagnostic[] = []
  const pushError = (severity: DiagnosticSeverity, message: string, start: number, end: number) => {
    diagnostics.push({
      message,
      severity,
      range: { start: lineMap.positionAt(start), end: lineMap.positionAt(end) },
    })
  }
  for (const err of doc.errors) {
    // Duplicate keys honor the configured severity; every other parser error is
    // a hard error.
    const severity = err.code === 'DUPLICATE_KEY' ? dupSeverity : DiagnosticSeverity.Error
    pushError(severity, err.message, err.start, err.end)
  }
  for (const warn of doc.warnings) {
    pushError(DiagnosticSeverity.Warning, warn.message, warn.start, warn.end)
  }

  const getLocationForJsonPath = (path: JsonPath, closest = false): ILocation | undefined => {
    const p = path.slice()
    while (true) {
      const range = index.get(pathKey(p))
      if (range) return { range }
      if (!closest || p.length === 0) return undefined
      p.pop()
    }
  }

  return { data, diagnostics, getLocationForJsonPath }
}
