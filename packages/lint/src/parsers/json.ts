import { getNodeValue, type Node, type ParseError, parseTree, printParseErrorCode } from 'jsonc-parser'

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
      const node = findNode(root, p)
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

/** An array index in the only spelling a JSON array answers to. */
const ARRAY_INDEX = /^(?:0|[1-9]\d*)$/

/**
 * The node at `path`, reading each segment by the kind of node it lands on.
 * `jsonc-parser`'s own `findNodeAtLocation` reads a number segment as an array
 * index only, and a finding's path spells an all-digit object key such as a
 * `"200"` response as the number `200`, so every finding under one resolved to
 * the enclosing object instead.
 */
const findNode = (root: Node, path: JsonPath): Node | undefined => {
  let node: Node | undefined = root
  for (const segment of path) {
    if (node === undefined) return undefined
    if (node.type === 'object') {
      const key = String(segment)
      // A property whose value failed to parse has only its key node. Skip it, as
      // `findNodeAtLocation` did, so a later spelling of the same key (the one
      // the parsed data actually holds) is the one found.
      const property: Node | undefined = node.children?.find(
        (child) => child.children?.length === 2 && child.children[0]?.value === key,
      )
      node = property?.children?.[1]
    } else if (node.type === 'array') {
      const text = String(segment)
      node = ARRAY_INDEX.test(text) ? node.children?.[Number(text)] : undefined
    } else {
      return undefined
    }
  }
  return node
}
