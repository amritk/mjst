import {
  isAlias,
  isMap,
  isPair,
  isScalar,
  isSeq,
  keyText,
  parseAllDocuments,
  type YamlDocument,
  type YamlNode,
  type YamlPair,
} from '@amritk/yaml'

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
 * Parses YAML (a JSON superset, so this handles both) into data plus a source
 * map, surfacing duplicate-key and incompatible-value diagnostics per `options`.
 *
 * A `---`-separated stream is parsed as multiple documents (via
 * `parseAllDocuments`), each linted independently: `data` becomes an array of
 * per-document values and every position key / finding path is prefixed with the
 * zero-based document index, so a violation in a later document resolves to its
 * own range instead of being silently dropped. A single-document source keeps the
 * flat shape — `data` is the document value and paths are unprefixed — so existing
 * callers and rulesets are unaffected. Node ranges are absolute offsets into the
 * shared source, so diagnostics and positions in later documents are already
 * correct without any per-document offset arithmetic.
 */
export const parseYaml = <T = unknown>(source: string, options: IParserOptions = {}): IParseResult<T> => {
  const lineMap = createLineMap(source)
  const duplicateKeys = options.duplicateKeys
  const dedupe = duplicateKeys === 'off' || duplicateKeys === false
  // A configured severity (Warning/Information/Hint) still detects duplicates; we
  // just re-map the reported severity below. Only `off`/`false` turns detection off.
  const dupSeverity = typeof duplicateKeys === 'number' ? duplicateKeys : DiagnosticSeverity.Error
  // Incompatible-value detection is opt-in: it runs only when a severity is
  // configured. `undefined`/`off`/`false` leaves it disabled.
  const incompatibleValues = options.incompatibleValues
  const incompatSeverity = typeof incompatibleValues === 'number' ? incompatibleValues : undefined
  const docs = parseAllDocuments(source, { uniqueKeys: !dedupe })
  const index = new Map<string, IRange>()

  const diagnostics: IDiagnostic[] = []
  const pushError = (severity: DiagnosticSeverity, message: string, start: number, end: number, code?: string) => {
    diagnostics.push({
      ...(code !== undefined ? { code } : {}),
      message,
      severity,
      range: { start: lineMap.positionAt(start), end: lineMap.positionAt(end) },
    })
  }

  const rangeOf = (node: YamlNode): IRange => ({
    start: lineMap.positionAt(node.start),
    end: lineMap.positionAt(node.end),
  })

  // Aliases are re-expanded into every path that reaches them, so nested aliases
  // (the "billion laughs" shape) can fan out super-linearly. Bound the total
  // nodes walked across the whole stream; on exhaustion we stop extending the
  // index rather than throw — untouched paths simply fall back to the closest
  // indexed ancestor.
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
      const childPath = [...path, keyText(item.key)]
      if (!index.has(pathKey(childPath))) walk(item.value, childPath)
    }
  }

  const walk = (node: YamlNode | null | undefined, path: JsonPath): void => {
    if (node == null || budget-- <= 0) return
    index.set(pathKey(path), rangeOf(node))

    if (isScalar(node)) {
      // The core schema projects `.nan`/`.inf`/`-.inf` to non-finite JS numbers,
      // which `JSON.stringify` silently rewrites to `null`. Report them when the
      // caller opted in, so a value that won't survive a JSON round-trip is caught.
      const value = node.value
      if (incompatSeverity !== undefined && typeof value === 'number' && !Number.isFinite(value)) {
        pushError(
          incompatSeverity,
          `Value ${String(value)} cannot be represented in JSON and will serialize to null.`,
          node.start,
          node.end,
          'INCOMPATIBLE_VALUE',
        )
      }
      return
    }

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
        // `keyText` is the parser's own key renderer, so a path segment is exactly
        // the key the projected data carries — and it shares the parser's work
        // budget, so a key built from nested aliases cannot hang the index.
        walk(item.value, [...path, keyText(item.key)])
      }
      // Merged keys fill positions the explicit keys above did not claim.
      for (const merge of merges) walkMerge(merge, path)
    } else if (isSeq(target)) {
      target.items.forEach((item, i) => {
        walk(item, [...path, i])
      })
    }
  }

  const collectProblems = (doc: YamlDocument): void => {
    for (const err of doc.errors) {
      // Duplicate keys honor the configured severity; every other parser error is
      // a hard error.
      const severity = err.code === 'DUPLICATE_KEY' ? dupSeverity : DiagnosticSeverity.Error
      // Carry the parser's stable code (`DUPLICATE_KEY`, `BAD_INDENT`, …) so a
      // caller can branch on the kind of problem without matching the message,
      // the same way `INCOMPATIBLE_VALUE` already does.
      pushError(severity, err.message, err.start, err.end, err.code)
    }
    for (const warn of doc.warnings) {
      pushError(DiagnosticSeverity.Warning, warn.message, warn.start, warn.end, warn.code)
    }
  }

  /**
   * Projects one document to plain data, turning a failed projection into a
   * diagnostic. `toJS` throws — catchably, by design — on a document whose
   * aliases would expand past its budget (the "billion laughs" shape) or whose
   * projection nests too deep. Letting that escape made a few hundred bytes of
   * YAML throw straight out of `createDocument` and every lint entry point, while
   * every other unusable document comes back as findings; `parseJson` reports its
   * own too-deep case the same way. The finding sits at the start of the document
   * that failed, and its value is `undefined`, as a JSON document's is when it
   * cannot be read at all.
   */
  const project = (doc: YamlDocument): unknown => {
    try {
      return doc.toJS()
    } catch (error) {
      const at = doc.contents?.start ?? 0
      const message = error instanceof Error ? error.message : String(error)
      pushError(DiagnosticSeverity.Error, message, at, at, 'RESOURCE_EXHAUSTION')
      return undefined
    }
  }

  let data: unknown
  if (docs.length > 1) {
    // Multi-document stream: index each document under its own `[i, …]` prefix and
    // project to an array of per-document values.
    data = docs.map((doc, i) => {
      walk(doc.contents, [i])
      collectProblems(doc)
      return project(doc)
    })
  } else {
    // Single document (or an empty stream): keep the flat, unprefixed shape.
    const doc = docs[0]
    if (doc) {
      walk(doc.contents, [])
      collectProblems(doc)
      data = project(doc)
    } else {
      data = null
    }
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

  return { data: data as T, diagnostics, getLocationForJsonPath }
}
