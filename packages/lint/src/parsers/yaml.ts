import { parseAllDocuments, type YamlDocument } from '@amritk/yaml'

import { createLineMap } from './lines'
import { DiagnosticSeverity, type IDiagnostic, type IParseResult, type IParserOptions } from './types'
import { createYamlLocator } from './yaml-locator'
import { reportNonFinite } from './yaml-non-finite'

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

  const diagnostics: IDiagnostic[] = []
  const pushError = (severity: DiagnosticSeverity, message: string, start: number, end: number, code?: string) => {
    diagnostics.push({
      ...(code !== undefined ? { code } : {}),
      message,
      severity,
      range: { start: lineMap.positionAt(start), end: lineMap.positionAt(end) },
    })
  }

  /**
   * Reports every non-finite number in a document when the caller opted in.
   * The core schema projects `.nan`/`.inf`/`-.inf` to non-finite JS numbers,
   * which `JSON.stringify` silently rewrites to `null`, so a value that will not
   * survive a JSON round-trip is caught here.
   */
  const checkIncompatible = (doc: YamlDocument): void => {
    if (incompatSeverity === undefined) return
    reportNonFinite(doc.contents, (node) => {
      pushError(
        incompatSeverity,
        `Value ${String(node.value)} cannot be represented in JSON and will serialize to null.`,
        node.start,
        node.end,
        'INCOMPATIBLE_VALUE',
      )
    })
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
    // Multi-document stream: positions are looked up under each document's own
    // `[i, …]` prefix, and the data is an array of per-document values.
    data = docs.map((doc) => {
      checkIncompatible(doc)
      collectProblems(doc)
      return project(doc)
    })
  } else {
    // Single document (or an empty stream): keep the flat, unprefixed shape.
    const doc = docs[0]
    if (doc) {
      checkIncompatible(doc)
      collectProblems(doc)
      data = project(doc)
    } else {
      data = null
    }
  }

  // Positions are resolved on demand, per path: a lint run asks for the few
  // paths that carry findings, and indexing every node up front cost more than
  // the parse itself on a large spec.
  const getLocationForJsonPath = createYamlLocator(docs, lineMap)

  return { data: data as T, diagnostics, getLocationForJsonPath }
}
