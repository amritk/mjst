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

/** Resolves a plain (unquoted) scalar to its core-schema JavaScript value. */
export const resolvePlainValue = (text: string): string | number | boolean | null => {
  // Empty plain scalar is null in YAML (e.g. a key with no value).
  if (text === '') return null

  // Cheap first-char gate: only a handful of characters can begin a non-string.
  const c = text.charCodeAt(0)
  const couldBeSpecial =
    c === 0x2e /* . */ ||
    c === 0x2d /* - */ ||
    c === 0x2b /* + */ ||
    c === 0x7e /* ~ */ ||
    (c >= 0x30 && c <= 0x39) /* 0-9 */ ||
    c === 0x6e /* n */ ||
    c === 0x4e /* N */ ||
    c === 0x74 /* t */ ||
    c === 0x54 /* T */ ||
    c === 0x66 /* f */ ||
    c === 0x46 /* F */
  if (!couldBeSpecial) return text

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
 * Folds the line breaks of a multi-line flow scalar: a single break becomes a
 * space, and each blank line becomes one literal newline. Leading and trailing
 * whitespace on continuation lines is trimmed, per the YAML flow folding rules.
 */
const foldLines = (text: string): string => {
  const lines = text.split('\n')
  if (lines.length === 1) return text
  let out = lines[0]?.replace(/[ \t]+$/, '') ?? ''
  let i = 1
  while (i < lines.length) {
    const trimmed = (lines[i] ?? '').trim()
    if (trimmed === '') {
      // Run of blank lines: each one contributes a newline.
      let blanks = 0
      while (i < lines.length && (lines[i] ?? '').trim() === '') {
        blanks++
        i++
      }
      out += '\n'.repeat(blanks)
      if (i < lines.length) {
        out += (lines[i] ?? '').trim()
        i++
      }
    } else {
      out += ' ' + trimmed
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
