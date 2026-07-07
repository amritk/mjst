import { findNodeAtLocation, getNodeValue, type ParseError, parseTree, printParseErrorCode } from 'jsonc-parser'

import { createLineMap } from './lines'
import { DiagnosticSeverity, type IDiagnostic, type ILocation, type IParseResult, type JsonPath } from './types'

/** Parses strict JSON into data plus a source map, reporting JSON-specific syntax errors. */
export const parseJson = <T = unknown>(source: string): IParseResult<T> => {
  const lineMap = createLineMap(source)
  const errors: ParseError[] = []
  const root = parseTree(source, errors, { allowTrailingComma: false, disallowComments: true })

  const data = (root ? getNodeValue(root) : undefined) as T

  const diagnostics: IDiagnostic[] = errors.map((err) => ({
    message: printParseErrorCode(err.error),
    severity: DiagnosticSeverity.Error,
    range: {
      start: lineMap.positionAt(err.offset),
      end: lineMap.positionAt(err.offset + err.length),
    },
  }))

  const getLocationForJsonPath = (path: JsonPath, closest = false): ILocation | undefined => {
    if (!root) return undefined
    const p = path.slice()
    while (true) {
      const node = findNodeAtLocation(root, p)
      if (node) {
        return {
          range: {
            start: lineMap.positionAt(node.offset),
            end: lineMap.positionAt(node.offset + node.length),
          },
        }
      }
      if (!closest || p.length === 0) return undefined
      p.pop()
    }
  }

  return { data, diagnostics, getLocationForJsonPath }
}
