/** A path into a parsed document: object keys and array indices from the root. */
export type JsonPath = (string | number)[]

/** A zero-based line/character position, matching LSP and Linter conventions. */
export type IPosition = {
  /** Zero-based line number. */
  line: number
  /** Zero-based character offset within the line. */
  character: number
}

/** An inclusive-start, exclusive-end span between two positions. */
export type IRange = {
  start: IPosition
  end: IPosition
}

/** A resolved source location — currently just the range a node occupies. */
export type ILocation = {
  range: IRange
}

/** Severity levels, ordered most-to-least severe to match LSP's numeric scale. */
export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

/** A problem reported by the parser itself (e.g. a syntax or duplicate-key error). */
export type IDiagnostic = {
  code?: string | number
  message: string
  path?: JsonPath
  range: IRange
  severity: DiagnosticSeverity
}

/** The result of parsing a document: its data, parser diagnostics, and a position lookup. */
export type IParseResult<T = unknown> = {
  data: T
  diagnostics: IDiagnostic[]
  /**
   * Returns the source location for a JSON path. When `closest` is true and the
   * exact path is not found, walks up to the nearest ancestor that is.
   */
  getLocationForJsonPath(path: JsonPath, closest?: boolean): ILocation | undefined
}

/** Tuning for how strictly the parser treats YAML/JSON edge cases. */
export type IParserOptions = {
  /**
   * Severity for duplicate object keys. Default: error. `false`/`"off"` disables
   * detection entirely; any {@link DiagnosticSeverity} reports the duplicate at
   * that level instead of the default error.
   */
  duplicateKeys?: DiagnosticSeverity | 'off' | false
  /**
   * Reserved: severity for YAML values that cannot round-trip through JSON.
   *
   * TODO: not yet implemented. The workspace YAML parser projects to core-schema
   * JavaScript values only (numbers, never bigints), so it currently cannot
   * produce a JSON-incompatible value — there is nothing to report. The option is
   * kept so the surface stays stable if a future schema (e.g. a `!!bigint` tag)
   * makes incompatible values possible; until then it has no effect.
   */
  incompatibleValues?: DiagnosticSeverity | 'off' | false
}
