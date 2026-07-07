import {
  type IDiagnostic,
  type ILocation,
  type IParserOptions,
  type JsonPath,
  type ParserFormat,
  parseWithPointers,
} from '@amritk/lint-parsers'

/** Options for {@link createDocument}: the parser options plus a display `source` and an explicit `format`. */
export type IDocumentOptions = IParserOptions & {
  source?: string
  format?: ParserFormat
}

/**
 * A source string paired with its parsed data and the source map that resolves
 * JSON paths back to line:column ranges. Parsing happens up front in
 * {@link createDocument}, so every field here is ready to read.
 */
export type Document<T = unknown> = {
  readonly source?: string | undefined
  readonly data: T
  readonly diagnostics: IDiagnostic[]
  getLocationForJsonPath(path: JsonPath, closest?: boolean): ILocation | undefined
}

/** Parses `input` into a {@link Document} with a source map for position lookups. */
export const createDocument = <T = unknown>(input: string, options: IDocumentOptions = {}): Document<T> => {
  const parsed = parseWithPointers<T>(input, options)
  return {
    source: options.source,
    data: parsed.data,
    diagnostics: parsed.diagnostics,
    getLocationForJsonPath: (path, closest = false) => parsed.getLocationForJsonPath(path, closest),
  }
}
