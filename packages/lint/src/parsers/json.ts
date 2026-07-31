import { findNodeAtLocation, getNodeValue, type ParseError, parseTree, printParseErrorCode } from 'jsonc-parser'

import { findExcessiveNesting, MAX_NESTING_DEPTH } from './depth'
import { createLineMap } from './lines'
import { DiagnosticSeverity, type IDiagnostic, type ILocation, type IParseResult, type JsonPath } from './types'

/** Parses strict JSON into data plus a source map, reporting JSON-specific syntax errors. */
export const parseJson = <T = unknown>(source: string): IParseResult<T> => {
  const lineMap = createLineMap(source)

  // A document nested deeper than this would overflow the call stack inside
  // jsonc-parser before we ever saw a node, so it is reported as a diagnostic up
  // front — the same way `@amritk/yaml` reports it, and the same way every other
  // unparseable document is reported. Throwing here would make a 40 KB file able
  // to kill the process linting it.
  const excessive = findExcessiveNesting(source)
  if (excessive !== -1) {
    const position = lineMap.positionAt(excessive)
    return {
      data: undefined as T,
      diagnostics: [
        {
          message: `Exceeded maximum nesting depth of ${MAX_NESTING_DEPTH}`,
          severity: DiagnosticSeverity.Error,
          range: { start: position, end: position },
        },
      ],
      getLocationForJsonPath: () => undefined,
    }
  }

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
