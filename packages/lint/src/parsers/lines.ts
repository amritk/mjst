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
 */
export const createLineMap = (source: string): LineMap => {
  const length = source.length
  // Offset at which each line starts. lineStarts[0] === 0.
  const lineStarts = [0]
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10 /* \n */) lineStarts.push(i + 1)
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
