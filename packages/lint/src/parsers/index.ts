export { type ApplyEditOpsResult, applyEditOps, applyEditOpsWithChanges, type EditOp } from './edit-model'
export { parseJson } from './json'
export { createLineMap, type LineMap } from './lines'
export {
  DiagnosticSeverity,
  type IDiagnostic,
  type ILocation,
  type IParseResult,
  type IParserOptions,
  type IPosition,
  type IRange,
  type JsonPath,
} from './types'
export { parseYaml } from './yaml'

import { parseJson } from './json'
import type { IParseResult, IParserOptions } from './types'
import { parseYaml } from './yaml'

/** Which concrete parser a document is routed to. */
export type ParserFormat = 'yaml' | 'json'

/** Guesses the format from the first non-whitespace character (`{`/`[` ⇒ JSON, else YAML). */
export const detectFormat = (source: string): ParserFormat => {
  const trimmed = source.trimStart()
  return trimmed.startsWith('{') || trimmed.startsWith('[') ? 'json' : 'yaml'
}

/**
 * Parses a document with source maps. YAML is a JSON superset, so the YAML
 * parser is the default and handles both; the JSON parser is used when a strict
 * JSON document is detected or requested (it reports JSON-specific errors).
 */
export const parseWithPointers = <T = unknown>(
  source: string,
  options: IParserOptions & { format?: ParserFormat } = {},
): IParseResult<T> => {
  const format = options.format ?? detectFormat(source)
  return format === 'json' ? parseJson<T>(source) : parseYaml<T>(source, options)
}
