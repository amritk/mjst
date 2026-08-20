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
 *   - an *unescaped* `/`, which would close the literal early;
 *   - a raw line terminator (LF, CR, U+2028, U+2029), which is not allowed
 *     inside a regex literal and would split the emitted `/…/` across lines (a
 *     syntax error); and
 *   - an *unpaired* surrogate, which is a legal JSON string and so a legal
 *     `pattern`, but has no UTF-8 encoding: writing the generated file replaced
 *     it with U+FFFD, so the emitted regex matched a different character than
 *     the schema asked for. A well-formed surrogate pair encodes fine and is
 *     left alone.
 *
 * Each is rewritten to its backslash escape, which matches the identical
 * character, so the regex's meaning is unchanged.
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
// Line terminators, keyed by code unit, and the backslash escape each maps to.
// These are the four characters disallowed *raw* inside a regex literal.
const lineTerminatorEscapes: Record<number, string> = {
  10: '\\n', // LF
  13: '\\r', // CR
  8232: '\\u2028', // LINE SEPARATOR
  8233: '\\u2029', // PARAGRAPH SEPARATOR
}

/** `\uXXXX` for one code unit — how an unpaired surrogate is written so it encodes. */
const unicodeEscape = (code: number): string => `\\u${code.toString(16).padStart(4, '0')}`

// Memoized results: the same schema pattern is escaped once per parser, per
// validator, and per assertion context, on every generation — and the dominant
// cost is the validating `new RegExp` compile. Schemas carry a bounded set of
// patterns; the cap only guards a pathological long-lived process.
const escapeCache = new Map<string, string>()
const modeCache = new Map<string, 'u' | '' | null>()
const ESCAPE_CACHE_LIMIT = 1000

/** Drops the oldest entry (Maps iterate in insertion order) once `cache` is full. */
const evictIfFull = <T>(cache: Map<string, T>): void => {
  // Evicting one instead of clearing wholesale means a corpus slightly over the
  // limit keeps its hot set rather than collapsing to a 0% hit rate every pass.
  if (cache.size >= ESCAPE_CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
}

/**
 * How `pattern` compiles: `'u'` when it is a legal Unicode-mode regex, `''` when
 * it is legal only without the flag, and `null` when it is not a regex at all.
 *
 * One decision, made once and cached, read by both functions below. They used to
 * decide separately and disagree: the validating compile omitted the `u` flag,
 * so a pattern that is legal *only* in Unicode mode — an astral range like
 * `[😀-😜]`, or `[\u{61}-\u{7A}]` — failed the build as an "invalid regex"
 * even though the emitter would have given it the `u` flag that makes it legal,
 * and Ajv (the differential oracle) accepts it. `u` is tried first because it is
 * the reading a 2020-12 `pattern` is meant to get.
 */
const compileMode = (pattern: string): 'u' | '' | null => {
  const cached = modeCache.get(pattern)
  if (cached !== undefined) return cached

  let mode: 'u' | '' | null
  try {
    new RegExp(pattern, 'u')
    mode = 'u'
  } catch {
    try {
      new RegExp(pattern)
      mode = ''
    } catch {
      mode = null
    }
  }

  evictIfFull(modeCache)
  modeCache.set(pattern, mode)
  return mode
}

export const escapeRegexPattern = (pattern: string): string => {
  const cached = escapeCache.get(pattern)
  if (cached !== undefined) return cached

  // Validate at generation time — a pattern that is a regex in neither mode must
  // fail here, not emit a `/([/` literal that breaks the generated file. The
  // message is recovered by recompiling, which only happens on the way to
  // throwing.
  if (compileMode(pattern) === null) {
    try {
      new RegExp(pattern, 'u')
    } catch (error) {
      throw new Error(
        `Invalid regex pattern ${JSON.stringify(pattern)}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  // Match either an escape sequence (`\` + any char, kept verbatim) or a single
  // character that would corrupt the literal (a bare `/` or a line terminator).
  // The line terminators are written as `\u….` escapes so this source file is
  // itself free of the raw characters it guards against. Consuming escape pairs
  // first means the slash in `\/` is never seen as bare, so it is not
  // double-escaped.
  const escaped = pattern.replace(
    /\\[\s\S]|[/\n\r\u2028\u2029]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    (match) => {
      // An escape pair like `\/` or `\d`: keep exactly as authored. (A pair
      // whose second half is a high surrogate leaves its low half unmatched,
      // because the lookbehind sees the high one — so an escaped astral
      // character is still emitted verbatim.)
      if (match.length !== 1) return match
      if (match === '/') return '\\/'
      const code = match.charCodeAt(0)
      return lineTerminatorEscapes[code] ?? unicodeEscape(code)
    },
  )

  // The empty pattern is valid JSON Schema (it matches everything), but an empty
  // regex body would emit `//` \u2014 a line comment, not a literal \u2014 and break the
  // generated file. Emit `(?:)` instead, exactly what `new RegExp('').source`
  // yields: an empty non-capturing group that still matches everything.
  const result = escaped === '' ? '(?:)' : escaped

  evictIfFull(escapeCache)
  escapeCache.set(pattern, result)
  return result
}

/**
 * The flags a generated regex for `pattern` should carry: `'u'` where the
 * pattern is a legal Unicode-mode regex, `''` where it is not.
 *
 * A 2020-12 `pattern` is meant to be read as Unicode — Ajv compiles with `u` by
 * default, and so does `@amritk/runtime-validators` (`compilePattern` in
 * `interpreter/interpret.ts`) — and without the flag `\p{L}` is misread as a
 * literal `p` and `^.$` rejects a single astral character. The flag is not
 * unconditional because `u` also outlaws escapes that are legal without it
 * (`\-`, a bare `\p`), and a pattern using one would turn into a syntax error in
 * the emitted regex literal. Compiling here is the same decision the interpreter
 * makes at runtime, taken once at generation time instead.
 */
export const regexFlagsFor = (pattern: string): string => compileMode(pattern) ?? ''

/**
 * A complete regex literal for a JSON Schema `pattern` — the escaped body
 * between slashes, with the flags {@link regexFlagsFor} picks.
 *
 * Emit sites take this rather than interpolating `escapeRegexPattern` into their
 * own `/…/`, so the flag decision is made in one place and cannot be forgotten
 * at one of the dozen places a pattern reaches generated code.
 *
 * @example
 * regexLiteral('\\p{L}+') // → '/\\p{L}+/u'
 * @throws if `pattern` is not a valid regular expression.
 */
export const regexLiteral = (pattern: string): string => `/${escapeRegexPattern(pattern)}/${regexFlagsFor(pattern)}`
