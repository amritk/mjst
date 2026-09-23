import type { IPosition } from './types'

/**
 * Resolves byte/char offsets to `{ line, character }` positions. Lines and
 * characters are zero-based, matching LSP / Linter conventions.
 */
export type LineMap = {
  positionAt(offset: number): IPosition
}

/**
 * Builds a {@link LineMap} for `source`. The line-start offsets are precomputed
 * once so each `positionAt` lookup is a binary search rather than a re-scan.
 *
 * A line ends at CR LF, a lone CR, or a lone LF — YAML 1.2 §5.4's
 * `b-break ::= CR LF | CR | LF`, which is also where JSON's scanner breaks lines.
 * Counting LF alone put every position in a CR-only file on line 0 while the
 * parser (and `@amritk/yaml`'s `lineCounter`) put it on its real line.
 */
export const createLineMap = (source: string): LineMap => {
  const length = source.length
  // Offset at which each line starts. lineStarts[0] === 0.
  const lineStarts = [0]
  // Hop break to break with `indexOf`, which the engine vectorizes, rather than
  // reading every character: this runs once per linted document, right after the
  // parse, and the same change was worth ~3x in the parser's own line counter.
  let nl = source.indexOf('\n')
  let cr = source.indexOf('\r')
  while (nl !== -1 || cr !== -1) {
    if (cr !== -1 && (nl === -1 || cr < nl)) {
      // CR LF is one break: step over both and move the LF scan past the one we
      // just consumed, or a Windows file would gain an empty line per real one.
      if (source.charCodeAt(cr + 1) === 10 /* \n */) {
        lineStarts.push(cr + 2)
        nl = source.indexOf('\n', cr + 2)
      } else {
        lineStarts.push(cr + 1)
      }
      cr = source.indexOf('\r', cr + 1)
    } else {
      lineStarts.push(nl + 1)
      nl = source.indexOf('\n', nl + 1)
    }
  }

  const positionAt = (offset: number): IPosition => {
    const clamped = Math.max(0, Math.min(offset, length))
    // Binary search for the last line start <= clamped.
    let low = 0
    let high = lineStarts.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if ((lineStarts[mid] ?? 0) <= clamped) low = mid
      else high = mid - 1
    }
    return { line: low, character: clamped - (lineStarts[low] ?? 0) }
  }

  return { positionAt }
}
