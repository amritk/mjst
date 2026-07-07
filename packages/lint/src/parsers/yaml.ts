import { isMap, isPair, isScalar, isSeq, parseDocument, type YamlNode } from '@amritk/yaml'

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

const pathKey = (path: JsonPath): string => path.join('\0')

/**
 * Parses YAML (a JSON superset, so this handles both) into data plus a source
 * map, surfacing duplicate-key and incompatible-value diagnostics per `options`.
 */
export const parseYaml = <T = unknown>(source: string, options: IParserOptions = {}): IParseResult<T> => {
  const lineMap = createLineMap(source)
  const dedupe = options.duplicateKeys === 'off' || options.duplicateKeys === false
  const doc = parseDocument(source, { uniqueKeys: !dedupe })
  const index = new Map<string, IRange>()

  const rangeOf = (node: YamlNode): IRange => ({
    start: lineMap.positionAt(node.start),
    end: lineMap.positionAt(node.end),
  })

  const walk = (node: YamlNode | null | undefined, path: JsonPath): void => {
    if (node == null) return
    index.set(pathKey(path), rangeOf(node))

    if (isMap(node)) {
      for (const item of node.items) {
        if (!isPair(item)) continue
        const key = item.key
        const keyName = isScalar(key) ? (key.value as string | number) : String(key)
        walk(item.value, [...path, keyName])
      }
    } else if (isSeq(node)) {
      node.items.forEach((item, i) => {
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
    pushError(DiagnosticSeverity.Error, err.message, err.start, err.end)
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
