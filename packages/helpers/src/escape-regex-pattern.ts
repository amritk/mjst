/**
 * Escapes a JSON Schema `pattern` so it can be embedded between the slashes of
 * a generated regex literal (`/…/`), and validates that the pattern is a legal
 * regex at generation time.
 *
 * A `pattern` is an ECMA-262 regex *body*, and the generated text goes into a
 * regex literal — not a string literal — so backslashes are regex syntax and
 * must be left exactly as-is (doubling `\d` to `\\d` would change it from "a
 * digit" to "a literal backslash followed by d"). Two things would otherwise
 * corrupt the surrounding literal:
 *   - an *unescaped* `/`, which would close the literal early; and
 *   - a raw line terminator (LF, CR, U+2028, U+2029), which is not allowed
 *     inside a regex literal and would split the emitted `/…/` across lines (a
 *     syntax error). Each is rewritten to its backslash escape, which matches
 *     the identical character, so the regex's meaning is unchanged.
 *
 * Additionally, an *invalid* pattern (e.g. `([`) would be emitted verbatim as
 * `/([/…` and produce output that does not parse. We compile the pattern with
 * `new RegExp` here and throw a clear generator-time error instead, so a bad
 * schema fails loudly during generation rather than emitting broken code.
 *
 * @example
 * escapeRegexPattern('\\d{4}/\\d{2}') // → '\\d{4}\\/\\d{2}'  (i.e. \d{4}\/\d{2})
 * @throws if `pattern` is not a valid regular expression.
 */
// Line terminators, keyed by code point, and the backslash escape each maps to.
// These are the four characters disallowed *raw* inside a regex literal.
const lineTerminatorEscapes: Record<number, string> = {
  10: '\\n', // LF
  13: '\\r', // CR
  8232: '\\u2028', // LINE SEPARATOR
  8233: '\\u2029', // PARAGRAPH SEPARATOR
}

// Memoized results: the same schema pattern is escaped once per parser, per
// validator, and per assertion context, on every generation — and the dominant
// cost is the validating `new RegExp` compile. Schemas carry a bounded set of
// patterns; the cap only guards a pathological long-lived process.
const escapeCache = new Map<string, string>()
const ESCAPE_CACHE_LIMIT = 1000

export const escapeRegexPattern = (pattern: string): string => {
  const cached = escapeCache.get(pattern)
  if (cached !== undefined) return cached

  // Validate at generation time — an invalid pattern must fail here, not emit
  // a `/([/` literal that breaks the generated file.
  try {
    new RegExp(pattern)
  } catch (error) {
    throw new Error(
      `Invalid regex pattern ${JSON.stringify(pattern)}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  // Match either an escape sequence (`\` + any char, kept verbatim) or a single
  // character that would corrupt the literal (a bare `/` or a line terminator).
  // The line terminators are written as `\u….` escapes so this source file is
  // itself free of the raw characters it guards against. Consuming escape pairs
  // first means the slash in `\/` is never seen as bare, so it is not
  // double-escaped.
  const escaped = pattern.replace(/\\[\s\S]|[/\n\r\u2028\u2029]/g, (match) => {
    if (match === '/') return '\\/'
    const terminatorEscape = lineTerminatorEscapes[match.charCodeAt(0)]
    if (terminatorEscape !== undefined && match.length === 1) return terminatorEscape
    // An escape pair like `\/` or `\d`: keep exactly as authored.
    return match
  })

  if (escapeCache.size >= ESCAPE_CACHE_LIMIT) {
    // Evict the single oldest entry (Maps iterate in insertion order) instead
    // of clearing wholesale — a corpus slightly over the limit keeps its hot
    // set instead of collapsing to a 0% hit rate every pass.
    escapeCache.delete(escapeCache.keys().next().value as string)
  }
  escapeCache.set(pattern, escaped)
  return escaped
}
