/** A resolved source position. Lines and columns are 1-based, the YAML convention. */
export type LinePos = {
  line: number
  col: number
}

export type LineCounter = {
  /** Maps a character offset to a 1-based `{ line, col }`. */
  linePos: (offset: number) => LinePos
}

/**
 * Builds an offset → `line:column` mapper for a source string.
 *
 * We scan once up front to record where each line starts, then every lookup is
 * a binary search — so turning the offset ranges on nodes and errors into
 * human-facing positions stays cheap even for large documents. Kept as a plain
 * factory (no class) to match the codebase style.
 */
export const lineCounter = (source: string): LineCounter => {
  const length = source.length
  // lineStarts[n] is the offset at which line (n + 1) begins; line 1 starts at 0.
  const lineStarts = [0]
  // Hop break to break with `indexOf` rather than reading every character:
  // `indexOf` is vectorized by the engine, which is worth roughly 3x here. That
  // matters because every lint run builds this index right after a parse, and a
  // per-character loop was costing ~14% of the combined time on a 2.7 MB spec.
  let nl = source.indexOf('\n')
  let cr = source.indexOf('\r')
  while (nl !== -1 || cr !== -1) {
    // YAML 1.2 §5.4: `b-break ::= CR LF | CR | LF`, so a lone CR opens a new
    // line just like an LF. CR LF is a *single* break — step over both and let
    // the LF scan skip past the one we just consumed, or a Windows document
    // would gain a phantom empty line between every pair of real ones.
    if (cr !== -1 && (nl === -1 || cr < nl)) {
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

  const linePos = (offset: number): LinePos => {
    const clamped = offset < 0 ? 0 : offset > length ? length : offset
    let low = 0
    let high = lineStarts.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if ((lineStarts[mid] ?? 0) <= clamped) low = mid
      else high = mid - 1
    }
    return { line: low + 1, col: clamped - (lineStarts[low] ?? 0) + 1 }
  }

  return { linePos }
}
