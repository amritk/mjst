import {
  createJsonLocator,
  detectFormat,
  type IDiagnostic,
  type ILocation,
  type IParserOptions,
  type JsonPath,
  type ParserFormat,
  parseWithPointers,
  parseYaml,
} from '../parsers'

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

/** Options for {@link createDocumentFromData}: where the data came from, if the caller still has it. */
export type IDataDocumentOptions = {
  /** Display path carried onto findings (e.g. a path relative to cwd, or a URL). */
  source?: string
  /**
   * The text the data was parsed from. Findings get line:column ranges from
   * it; without it every range is the zero range. Paths that the caller's own
   * normalization moved resolve to the closest ancestor the text has.
   */
  text?: string
  /** The format of `text`; detected from its first character when omitted. */
  format?: ParserFormat
}

/**
 * Wraps data a caller has already parsed in a {@link Document}, so a lint run
 * does not parse the text a second time.
 *
 * Positions are worked out only when asked for, which in a lint run means
 * only for the nodes that carry findings. For JSON text that is a scan of
 * just the containers on the way to each path; YAML text is parsed on the
 * first request (YAML positions cannot be found without a parse). The
 * document reports no parser diagnostics: the caller's own parse already had
 * its say on the text.
 */
export const createDocumentFromData = <T = unknown>(data: T, options: IDataDocumentOptions = {}): Document<T> => {
  const { text } = options
  let locate: ((path: JsonPath, closest?: boolean) => ILocation | undefined) | undefined
  const getLocationForJsonPath = (path: JsonPath, closest = false): ILocation | undefined => {
    if (text === undefined) return undefined
    if (locate === undefined) {
      const format = options.format ?? detectFormat(text)
      locate = format === 'json' ? createJsonLocator(text) : parseYaml(text).getLocationForJsonPath
    }
    return locate(path, closest)
  }
  return { source: options.source, data, diagnostics: [], getLocationForJsonPath }
}
