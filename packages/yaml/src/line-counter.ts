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
  for (let i = 0; i < length; i++) {
    if (source.charCodeAt(i) === 10 /* \n */) lineStarts.push(i + 1)
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
