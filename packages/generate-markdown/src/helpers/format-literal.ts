/**
 * Language ids we render values as JavaScript object literals for. Everything
 * else gets JSON, which is the safer default: a `.json` config example has to
 * parse, while a JS example reads better with unquoted keys and single quotes
 * (and that is exactly how the docs we are matching write them).
 */
const JAVASCRIPT_LANGUAGES: ReadonlySet<string> = new Set(['js', 'javascript', 'jsx', 'ts', 'tsx', 'typescript'])

/** True when values on this page should render as JavaScript rather than JSON. */
export const isJavaScriptLanguage = (language: string): boolean => JAVASCRIPT_LANGUAGES.has(language.toLowerCase())

/** Keys a JavaScript literal can write bare, without quotes. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/**
 * How deep a value is serialized before it collapses to `null`. A config
 * default nested deeper than this is not something a reader can follow in a
 * code fence anyway, and the cap also keeps a caller-supplied cyclic object
 * (never a parsed schema, but the API takes `unknown`) from blowing the stack.
 *
 * The truncation renders as `null` rather than an ellipsis because the fence
 * claims a language: a `…` inside a ```json block is a sample that does not
 * parse, which is the same trap the non-finite number handling below avoids.
 */
const MAX_DEPTH = 32

/**
 * Single-quoted JavaScript string. Control characters are escaped rather than
 * written raw, because a literal newline inside a `**Default:**` code span
 * would break out of the span and take the rest of the line with it.
 */
const quoteJs = (value: string): string =>
  `'${value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')}'`

/** Entries worth printing: `undefined` has no JSON (or JS literal) spelling. */
const definedEntries = (value: Record<string, unknown>): readonly (readonly [string, unknown])[] =>
  Object.entries(value).filter(([, entry]) => entry !== undefined)

/**
 * Renders a value on a single line — what the **Default:** line and table cells
 * need, where a multi-line literal would break the surrounding markdown.
 */
export const formatInlineLiteral = (value: unknown, language: string, depth = 0): string => {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return String(value)
  // `1e400` interpolates as `Infinity`, which no JSON parser accepts — telling a
  // reader to type it would be worse than saying nothing.
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null'
  if (typeof value === 'string') return isJavaScriptLanguage(language) ? quoteJs(value) : JSON.stringify(value)
  if (depth >= MAX_DEPTH) return 'null'
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return `[${value.map((entry) => formatInlineLiteral(entry, language, depth + 1)).join(', ')}]`
  }
  if (typeof value !== 'object') return ''
  const entries = definedEntries(value as Record<string, unknown>)
  if (entries.length === 0) return '{}'
  const js = isJavaScriptLanguage(language)
  const body = entries
    .map(([key, entry]) => {
      const label = js && IDENTIFIER.test(key) ? key : js ? quoteJs(key) : JSON.stringify(key)
      return `${label}: ${formatInlineLiteral(entry, language, depth + 1)}`
    })
    .join(', ')
  return js ? `{ ${body} }` : `{${body}}`
}

/**
 * Renders a value the way it would be written in a config file: pretty-printed
 * across lines, in JSON or JavaScript depending on the page's language. Used for
 * the code fences derived from a property's `examples`.
 */
export const formatLiteral = (value: unknown, language: string, indent = '', depth = 0): string => {
  const js = isJavaScriptLanguage(language)
  if (depth >= MAX_DEPTH || value === null || typeof value !== 'object') {
    return formatInlineLiteral(value, language, depth)
  }
  const inner = `${indent}  `
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const items = value.map((entry) => `${inner}${formatLiteral(entry, language, inner, depth + 1)}`)
    return `[\n${items.join(',\n')}\n${indent}]`
  }
  const entries = definedEntries(value as Record<string, unknown>)
  if (entries.length === 0) return '{}'
  const lines = entries.map(([key, entry]) => {
    const label = js && IDENTIFIER.test(key) ? key : js ? quoteJs(key) : JSON.stringify(key)
    return `${inner}${label}: ${formatLiteral(entry, language, inner, depth + 1)}`
  })
  return `{\n${lines.join(',\n')}\n${indent}}`
}
