import { isAlias, isMap, isPair, isScalar, isSeq, parseDocument, type YamlNode } from '@amritk/yaml'

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
 * Stringifies a mapping key exactly as `toJS` does, so the position index keys
 * agree with the keys the projected data exposes: a null key is `null`, a
 * bool/number key is its `String()` form, an alias key is `*name`, and a complex
 * (map/seq) key is empty — never `[object Object]`.
 */
const keyToString = (key: YamlNode): string => {
  if (isScalar(key)) {
    const v = key.value
    return typeof v === 'string' ? v : v === null ? 'null' : String(v)
  }
  if (isAlias(key)) return `*${key.source}`
  return ''
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
  // Incompatible-value detection is opt-in: it runs only when a severity is
  // configured. `undefined`/`off`/`false` leaves it disabled.
  const incompatibleValues = options.incompatibleValues
  const incompatSeverity = typeof incompatibleValues === 'number' ? incompatibleValues : undefined
  const doc = parseDocument(source, { uniqueKeys: !dedupe })
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

  const walk = (node: YamlNode | null | undefined, path: JsonPath): void => {
    if (node == null) return
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
    } else if (isMap(node)) {
      for (const item of node.items) {
        if (!isPair(item)) continue
        walk(item.value, [...path, keyToString(item.key)])
      }
    } else if (isSeq(node)) {
      node.items.forEach((item, i) => {
        walk(item, [...path, i])
      })
    }
  }

  walk(doc.contents, [])

  const data = doc.toJS() as T

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
