/**
 * Scalar resolution: turning raw YAML text into a JavaScript value.
 *
 * We follow the YAML 1.2 "core schema" tag-resolution rules for plain scalars
 * (null / bool / int / float / string) and the standard escape rules for
 * quoted scalars. The hot path — a plain scalar with no special characters — is
 * a couple of cheap comparisons before any regex runs.
 */

const INT_DEC = /^[-+]?[0-9]+$/
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
  if (INT_HEX.test(text)) return Number.parseInt(text.replace('0x', ''), 16) * (text[0] === '-' ? -1 : 1)
  if (INT_OCT.test(text)) return Number.parseInt(text.replace('0o', ''), 8) * (text[0] === '-' ? -1 : 1)
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
const lstrip = (s: string): string => s.replace(/^[ \t]+/, '')
const rstrip = (s: string): string => s.replace(/[ \t]+$/, '')

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

/** Resolves a single-quoted scalar: the only escape is `''` → `'`, plus folding. */
export const resolveSingleQuoted = (inner: string): string => {
  const folded = inner.indexOf('\n') === -1 ? inner : foldLines(inner)
  return folded.indexOf("''") === -1 ? folded : folded.replace(/''/g, "'")
}

/** Resolves a double-quoted scalar: full escape handling, line continuation, and folding. */
export const resolveDoubleQuoted = (inner: string): string => {
  // Fast path: a plain double-quoted string with nothing to process.
  if (inner.indexOf('\\') === -1 && inner.indexOf('\n') === -1) return inner

  const source = inner.indexOf('\n') === -1 ? inner : foldLines(inner)
  let out = ''
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    if (ch !== '\\') {
      out += ch
      i++
      continue
    }
    const next = source[i + 1]
    if (next === undefined) {
      out += '\\'
      break
    }
    if (next === 'x' || next === 'u' || next === 'U') {
      const len = next === 'x' ? 2 : next === 'u' ? 4 : 8
      const hex = source.slice(i + 2, i + 2 + len)
      const code = Number.parseInt(hex, 16)
      out += Number.isNaN(code) ? next : String.fromCodePoint(code)
      i += 2 + len
      continue
    }
    const mapped = DOUBLE_ESCAPES[next]
    out += mapped ?? next
    i += 2
  }
  return out
}
