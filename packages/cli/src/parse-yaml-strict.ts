import { lineCounter, type ParseOptions, parseDocument, type YamlError } from '@amritk/yaml'

/** How many parse problems a message lists before summarizing the rest as a count. */
const MAX_LISTED_PROBLEMS = 5

export type ParseYamlStrictOptions = ParseOptions & {
  /**
   * What the file is required to be, for the multi-document message — `an
   * AsyncAPI document`, `a $ref target` — so the reader learns why a perfectly
   * valid YAML stream was refused.
   */
  what: string
  /**
   * Join the listed problems into one line (`; `) instead of one `  - ` bullet
   * per line. For reports that print one line per finding, where a line break
   * in the message would read as a new, unlabelled finding.
   */
  singleLine?: boolean
}

/**
 * Builds the "Failed to parse" message. Cold: only a document that failed to
 * parse pays for the line index, and every problem is located as
 * `path:line:col` so an editor or terminal can jump straight to it.
 */
const describeParseErrors = (
  errors: YamlError[],
  text: string,
  location: string,
  singleLine: boolean | undefined,
): string => {
  const { linePos } = lineCounter(text)
  const listed = errors.slice(0, MAX_LISTED_PROBLEMS).map((error) => {
    const { line, col } = linePos(error.start)
    return `${location}:${line}:${col}: ${error.message}`
  })
  if (errors.length > MAX_LISTED_PROBLEMS) listed.push(`…and ${errors.length - MAX_LISTED_PROBLEMS} more`)
  const body = singleLine ? ` ${listed.join('; ')}` : listed.map((problem) => `\n  - ${problem}`).join('')
  return `Failed to parse ${location} as YAML:${body}`
}

/** Builds the multi-document message, pointing at the `---` that opens the second document. */
const describeMultipleDocuments = (warning: YamlError, text: string, location: string, what: string): string => {
  const { line, col } = lineCounter(text).linePos(warning.start)
  return `${location} contains multiple YAML documents (the second starts at ${location}:${line}:${col}); ${what} must be a single-document file.`
}

/**
 * Parses `text` as a single YAML document and returns its value, throwing
 * instead of handing back anything the parser had to guess at.
 *
 * `@amritk/yaml` collects problems rather than throwing, and `parse` returns
 * the salvage of a malformed document as if it were fine — an unclosed `[`
 * swallows the lines after it into a bogus key, and the caller builds on data
 * the file does not contain. It also reads only the first document of a `---`
 * stream, flagging the rest with a `MULTIPLE_DOCUMENTS` warning, so a file
 * whose second half silently vanished would be reported as a success. Both are
 * turned into an error here, naming `location` and each problem's `line:col`.
 */
export const parseYamlStrict = (text: string, location: string, options: ParseYamlStrictOptions): unknown => {
  const { what, singleLine, ...parseOptions } = options
  const doc = parseDocument(text, parseOptions)
  if (doc.errors.length > 0) throw new Error(describeParseErrors(doc.errors, text, location, singleLine))
  const multiple = doc.warnings.find((warning) => warning.code === 'MULTIPLE_DOCUMENTS')
  if (multiple !== undefined) throw new Error(describeMultipleDocuments(multiple, text, location, what))
  return doc.toJS()
}
