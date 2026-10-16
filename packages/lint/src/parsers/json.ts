import { getNodeValue, type Node, type ParseError, parseTree, printParseErrorCode } from 'jsonc-parser'

import { findExcessiveNesting, MAX_NESTING_DEPTH } from './depth'
import { createJsonLocator } from './json-locator'
import { createLineMap, type LineMap } from './lines'
import { DiagnosticSeverity, type IDiagnostic, type ILocation, type IParseResult, type JsonPath } from './types'

/** Parses strict JSON into data plus a source map, reporting JSON-specific syntax errors. */
export const parseJson = <T = unknown>(source: string): IParseResult<T> => {
  // A document nested deeper than this would overflow the call stack inside
  // jsonc-parser before we ever saw a node, so it is reported as a diagnostic up
  // front — the same way `@amritk/yaml` reports it, and the same way every other
  // unparseable document is reported. Throwing here would make a 40 KB file able
  // to kill the process linting it.
  const excessive = findExcessiveNesting(source)
  if (excessive !== -1) {
    const position = createLineMap(source).positionAt(excessive)
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

  // Valid JSON — nearly every document — is read by the engine's own parser,
  // several times faster than building a `jsonc-parser` tree and projecting
  // it, and positions come from scanning the text for just the paths a
  // caller asks about. The tree is only built for a document `JSON.parse`
  // rejects, where its recovery and error positions are the point.
  const fast = parseValidJson<T>(source)
  if (fast !== undefined) return fast

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

  const getLocationForJsonPath = root ? createTreeLocator(root, lineMap) : () => undefined

  return { data, diagnostics, getLocationForJsonPath }
}

/**
 * Parses `source` with `JSON.parse`, or returns `undefined` when it is not
 * valid JSON. The data matches what the tree parser projects for the same
 * text — the same values, the last of any duplicate key — with one
 * difference: objects get the ordinary prototype rather than none, which is
 * what the YAML parser has always produced, so rules already read documents
 * through own-key checks.
 */
const parseValidJson = <T>(source: string): IParseResult<T> | undefined => {
  let data: T
  try {
    data = JSON.parse(source) as T
  } catch {
    return undefined
  }
  return { data, diagnostics: [], getLocationForJsonPath: createJsonLocator(source) }
}

/**
 * Resolves paths against a `jsonc-parser` tree. When `closest` is set and the
 * path leaves the document, the deepest node it reached is returned.
 */
export const createTreeLocator =
  (root: Node, lineMap: LineMap) =>
  (path: JsonPath, closest = false): ILocation | undefined => {
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
