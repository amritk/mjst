/**
 * Scalar resolution: turning raw YAML text into a JavaScript value.
 *
 * We follow the YAML 1.2 "core schema" tag-resolution rules for plain scalars
 * (null / bool / int / float / string) and the standard escape rules for
 * quoted scalars. The hot path — a plain scalar with no special characters — is
 * a couple of cheap comparisons before any regex runs.
 */

const INT_DEC = /^[-+]?[0-9]+$/
// The 1.2 core schema writes these unsigned (`0x[0-9a-fA-F]+`, `0o[0-7]+`), so
// strictly `-0x10` should stay the string `"-0x10"` — which is what `yaml`
// (eemeli) does. We accept the sign, matching `js-yaml` and YAML 1.1: a config
// author who writes `-0x10` means -16, and a released fix already pinned that
// (`resolve-scalar.test.ts`). Narrowing it now would be a silent breaking
// change for the one reading nobody actually intends.
const INT_HEX = /^[-+]?0x[0-9a-fA-F]+$/
const INT_OCT = /^[-+]?0o[0-7]+$/
// Float requires a `.` or exponent so version strings like `1.0.0` stay strings.
const FLOAT = /^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?$/

/**
 * First-character gate as a 128-entry lookup table. Only a handful of characters
 * can begin a non-string scalar; the overwhelmingly common case is a key or
 * value whose first char is a plain letter, so a single indexed read beats the
 * branch chain it replaces. Built once at module load.
 */
const MAYBE_SPECIAL = /* @__PURE__ */ (() => {
  const t = new Uint8Array(128)
  t[0x2e] = 1 // .
  t[0x2d] = 1 // -
  t[0x2b] = 1 // +
  t[0x7e] = 1 // ~
  for (let d = 0x30; d <= 0x39; d++) t[d] = 1 // 0-9
  t[0x6e] = 1 // n
  t[0x4e] = 1 // N
  t[0x74] = 1 // t
  t[0x54] = 1 // T
  t[0x66] = 1 // f
  t[0x46] = 1 // F
  return t
})()

/** Resolves a plain (unquoted) scalar to its core-schema JavaScript value. */
export const resolvePlainValue = (text: string): string | number | boolean | null => {
  // Empty plain scalar is null in YAML (e.g. a key with no value).
  if (text === '') return null

  // Cheap first-char gate: only a handful of characters can begin a non-string.
  const c = text.charCodeAt(0)
  if (c >= 128 || MAYBE_SPECIAL[c] === 0) return text

  switch (text) {
    case '~':
    case 'null':
    case 'Null':
    case 'NULL':
      return null
    case 'true':
    case 'True':
    case 'TRUE':
      return true
    case 'false':
    case 'False':
    case 'FALSE':
      return false
    case '.inf':
    case '.Inf':
    case '.INF':
    case '+.inf':
    case '+.Inf':
    case '+.INF':
      return Number.POSITIVE_INFINITY
    case '-.inf':
    case '-.Inf':
    case '-.INF':
      return Number.NEGATIVE_INFINITY
    case '.nan':
    case '.NaN':
    case '.NAN':
      return Number.NaN
    default:
      break
  }

  // Only digits, signs, and `.` can begin a number. A word starting with
  // n/N/t/T/f/F that was not a keyword above is a plain string, so we can skip
  // the numeric regexes entirely — a meaningful win on key-heavy documents.
  if (c === 0x6e || c === 0x4e || c === 0x74 || c === 0x54 || c === 0x66 || c === 0x46) return text

  if (INT_DEC.test(text)) return Number.parseInt(text, 10)
  // `parseInt` already honours a leading sign, so stripping only the `0x`/`0o`
  // base marker leaves e.g. `-10` for it to parse as -16. An extra sign multiply
  // here would double-negate and flip `-0x10` back to +16.
  if (INT_HEX.test(text)) return Number.parseInt(text.replace('0x', ''), 16)
  if (INT_OCT.test(text)) return Number.parseInt(text.replace('0o', ''), 8)
  if (FLOAT.test(text)) return Number.parseFloat(text)

  return text
}

const DOUBLE_ESCAPES: Record<string, string> = {
  '0': '\0',
  a: '\x07',
  b: '\b',
  t: '\t',
  '\t': '\t',
  n: '\n',
  v: '\v',
  f: '\f',
  r: '\r',
  e: '\x1b',
  ' ': ' ',
  '"': '"',
  '/': '/',
  '\\': '\\',
  N: '',
  _: ' ',
  L: ' ',
  P: ' ',
}

const lstrip = (s: string): string => s.replace(/^[ \t]+/, '')
const rstrip = (s: string): string => s.replace(/[ \t]+$/, '')

/**
 * Folds the line breaks of a multi-line flow scalar, per the YAML flow folding
 * rules: a single break between content becomes a space, and a run of blank
 * lines becomes that many literal newlines.
 *
 * Whitespace handling mirrors what the spec keeps as content vs. discards:
 * - leading whitespace on a continuation line is folding indentation, so it is
 *   always dropped;
 * - trailing whitespace is dropped on every line *except the last*, where no
 *   line break follows so the spaces are literal content;
 * - a blank-line run that reaches the end of the scalar yields one fewer
 *   newline, because the break before the closing delimiter is stripped.
 */
const foldLines = (text: string): string => {
  const lines = text.split('\n')
  if (lines.length === 1) return text
  const last = lines.length - 1
  let out = rstrip(lines[0] ?? '')
  let i = 1
  while (i <= last) {
    if ((lines[i] ?? '').trim() === '') {
      // Run of blank lines.
      let blanks = 0
      while (i <= last && (lines[i] ?? '').trim() === '') {
        blanks++
        i++
      }
      if (i > last) {
        // Trailing run reaching the closing delimiter: a lone break still folds
        // to a space; any further blank lines each drop one break, so a run of
        // `n` contributes `n - 1` newlines.
        out += blanks === 1 ? ' ' : '\n'.repeat(blanks - 1)
      } else {
        // Interior run: each blank line is one newline, then the next content.
        out += '\n'.repeat(blanks)
        out += i === last ? lstrip(lines[i] ?? '') : (lines[i] ?? '').trim()
        i++
      }
    } else {
      // Single break folds to a space. Keep trailing whitespace only on the
      // final line, where it is literal content rather than folding padding.
      out += ' ' + (i === last ? lstrip(lines[i] ?? '') : (lines[i] ?? '').trim())
      i++
    }
  }
  return out
}

/**
 * Normalizes YAML line breaks (`\r\n` and lone `\r`) to `\n` before folding. YAML
 * treats all three as a single line break, but `foldLines` splits only on `\n`
 * and `rstrip` trims only spaces/tabs — so without this a folded CRLF line would
 * keep a stray `\r` in its content (`"first\r second"` instead of `"first second"`).
 * The check is a cheap `indexOf` so the common LF-only case allocates nothing.
 */
const normalizeBreaks = (s: string): string => (s.indexOf('\r') === -1 ? s : s.replace(/\r\n?/g, '\n'))

/** Resolves a single-quoted scalar: the only escape is `''` → `'`, plus folding. */
export const resolveSingleQuoted = (inner: string): string => {
  const normalized = normalizeBreaks(inner)
  const folded = normalized.indexOf('\n') === -1 ? normalized : foldLines(normalized)
  return folded.indexOf("''") === -1 ? folded : folded.replace(/''/g, "'")
}

/**
 * One line of a double-quoted scalar, already unescaped, carrying what the
 * folding rules need in order to tell padding from content.
 *
 * Folding drops each joined line's indentation and trailing whitespace — but a
 * `\t` or `\ ` escape *is* content and has to survive. Recording where the
 * escaped characters landed is what lets {@link sliceQuoted} strip only the
 * whitespace the document wrote literally. Unescaping before folding (rather
 * than after, as this used to) is also what makes a `\`-continuation work: the
 * break it escapes must never become the space a plain break folds to.
 */
type QuotedLine = {
  text: string
  /** Index of the first character an escape produced, or -1 when the line has none. */
  firstEsc: number
  /** Index of the last character an escape produced, or -1 when the line has none. */
  lastEsc: number
  /** The line ended in a `\` line continuation, which swallows the break entirely. */
  continues: boolean
}

const isWs = (c: number): boolean => c === 32 || c === 9

/** Unescapes one line of a double-quoted scalar; see {@link QuotedLine}. */
const unescapeLine = (line: string, allowContinuation: boolean): QuotedLine => {
  let text = ''
  let firstEsc = -1
  let lastEsc = -1
  let i = 0
  while (i < line.length) {
    const ch = line[i]
    if (ch !== '\\') {
      text += ch
      i++
      continue
    }
    const next = line[i + 1]
    if (next === undefined) {
      // A trailing `\` escapes the line break: the break and the next line's
      // indentation both vanish. On the final line there is nothing to continue
      // into, so it stays a literal backslash.
      if (allowContinuation) return { text, firstEsc, lastEsc, continues: true }
      text += '\\'
      break
    }
    const before = text.length
    if (next === 'x' || next === 'u' || next === 'U') {
      const len = next === 'x' ? 2 : next === 'u' ? 4 : 8
      const hex = line.slice(i + 2, i + 2 + len)
      // The escape is only valid with exactly `len` hex digits naming a real Unicode
      // code point. A short/non-hex run (`\xZZ`) or an out-of-range value (`\UFFFFFFFF`,
      // which would make `String.fromCodePoint` throw) is treated as a literal escape
      // letter, consuming just `\x` so the trailing characters are preserved.
      const valid = hex.length === len && /^[0-9a-fA-F]+$/.test(hex)
      const code = valid ? Number.parseInt(hex, 16) : Number.NaN
      if (code <= 0x10ffff && !Number.isNaN(code)) {
        text += String.fromCodePoint(code)
        i += 2 + len
      } else {
        text += next
        i += 2
      }
    } else {
      const mapped = DOUBLE_ESCAPES[next]
      text += mapped ?? next
      i += 2
    }
    if (text.length > before) {
      if (firstEsc === -1) firstEsc = before
      lastEsc = text.length - 1
    }
  }
  return { text, firstEsc, lastEsc, continues: false }
}

/**
 * The line's text with its folding padding removed: leading whitespace up to
 * the first escaped character, trailing whitespace back to the last one.
 */
const sliceQuoted = (line: QuotedLine, dropLeading: boolean, dropTrailing: boolean): string => {
  let start = 0
  let end = line.text.length
  if (dropLeading) {
    const ceiling = line.firstEsc === -1 ? end : line.firstEsc
    while (start < ceiling && isWs(line.text.charCodeAt(start))) start++
  }
  if (dropTrailing) {
    const floor = Math.max(start, line.lastEsc + 1)
    while (end > floor && isWs(line.text.charCodeAt(end - 1))) end--
  }
  return line.text.slice(start, end)
}

/** A line that folding treats as a break rather than as content. Escaped whitespace is content. */
const isBlankQuoted = (line: QuotedLine | undefined): boolean =>
  line !== undefined && line.firstEsc === -1 && line.text.trim() === ''

/**
 * Unescapes and folds a multi-line double-quoted scalar. The folding rules are
 * {@link foldLines}': a single break becomes a space and a run of blank lines
 * becomes that many newlines — applied here to lines that already know which of
 * their whitespace came from an escape.
 */
const foldQuotedLines = (raw: string[]): string => {
  const merged: QuotedLine[] = []
  for (let i = 0; i < raw.length; i++) {
    const line = unescapeLine(raw[i] ?? '', i < raw.length - 1)
    const prev = merged[merged.length - 1]
    if (prev === undefined || !prev.continues) {
      merged.push(line)
      continue
    }
    // Splice a `\`-continued line onto the one before it: no separator, and the
    // continuation's own indentation is dropped. The previous line keeps its
    // trailing whitespace — the `\` protected it from the fold.
    let cut = 0
    const ceiling = line.firstEsc === -1 ? line.text.length : line.firstEsc
    while (cut < ceiling && isWs(line.text.charCodeAt(cut))) cut++
    const shift = prev.text.length - cut
    prev.text += line.text.slice(cut)
    if (prev.firstEsc === -1 && line.firstEsc !== -1) prev.firstEsc = line.firstEsc + shift
    if (line.lastEsc !== -1) prev.lastEsc = line.lastEsc + shift
    prev.continues = line.continues
  }

  const last = merged.length - 1
  const head = merged[0]
  let out = head === undefined ? '' : sliceQuoted(head, false, true)
  let i = 1
  while (i <= last) {
    if (isBlankQuoted(merged[i])) {
      let blanks = 0
      while (i <= last && isBlankQuoted(merged[i])) {
        blanks++
        i++
      }
      if (i > last) {
        // Trailing run reaching the closing quote: a lone break still folds to a
        // space; each further blank line drops one break.
        out += blanks === 1 ? ' ' : '\n'.repeat(blanks - 1)
      } else {
        out += '\n'.repeat(blanks)
        out += sliceQuoted(merged[i] as QuotedLine, true, i !== last)
        i++
      }
    } else {
      // Trailing whitespace is content only on the final line, where no break
      // follows it.
      out += ' ' + sliceQuoted(merged[i] as QuotedLine, true, i !== last)
      i++
    }
  }
  return out
}

/** Resolves a double-quoted scalar: full escape handling, line continuation, and folding. */
export const resolveDoubleQuoted = (rawInner: string): string => {
  const inner = normalizeBreaks(rawInner)
  const multiline = inner.indexOf('\n') !== -1
  // Fast path: a plain double-quoted string with nothing to process.
  if (!multiline && inner.indexOf('\\') === -1) return inner
  if (!multiline) return unescapeLine(inner, false).text
  return foldQuotedLines(inner.split('\n'))
}
