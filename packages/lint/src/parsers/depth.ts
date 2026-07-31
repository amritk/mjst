/**
 * The deepest `{`/`[` nesting a JSON document may use. This matches the limit
 * `@amritk/yaml` enforces while parsing, so both parsers refuse the same
 * documents and report it the same way.
 */
export const MAX_NESTING_DEPTH = 1000

/**
 * Finds the offset of the bracket that first pushes `source` past `limit` levels
 * of nesting, or `-1` when the document stays within it.
 *
 * We need this *before* handing the text to a parser: `'['.repeat(20000)` is a
 * 40 KB file, and a recursive-descent JSON parser (jsonc-parser, and then
 * `getNodeValue` after it) blows the call stack on it — a `RangeError` that
 * escapes as a crash instead of arriving as a diagnostic like every other
 * malformed document does. Counting brackets is a single linear scan, so the
 * check costs nothing on real files.
 *
 * Only string literals need to be skipped; JSON has no comments, and a `[` inside
 * a string must not count toward the depth.
 */
export const findExcessiveNesting = (source: string, limit: number = MAX_NESTING_DEPTH): number => {
  let depth = 0
  let inString = false
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{' || ch === '[') {
      depth++
      if (depth > limit) return i
    } else if (ch === '}' || ch === ']') depth--
  }
  return -1
}
