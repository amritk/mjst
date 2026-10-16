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
  const length = source.length
  let depth = 0
  for (let i = 0; i < length; i++) {
    const code = source.charCodeAt(i)
    if (code === 34 /* " */) {
      // Jump to the closing quote: one the engine finds with a vectorized
      // search, where reading the string a character at a time was most of
      // this scan's cost. A quote preceded by an odd run of backslashes is
      // escaped. An unterminated string runs to the end, where no bracket
      // counts.
      let close = source.indexOf('"', i + 1)
      while (close !== -1) {
        let slashes = 0
        for (let j = close - 1; source.charCodeAt(j) === 92 /* \ */; j--) slashes++
        if ((slashes & 1) === 0) break
        close = source.indexOf('"', close + 1)
      }
      if (close === -1) return -1
      i = close
    } else if (code === 123 /* { */ || code === 91 /* [ */) {
      depth++
      if (depth > limit) return i
    } else if (code === 125 /* } */ || code === 93 /* ] */) depth--
  }
  return -1
}
