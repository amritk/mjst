import type { IDiagnostic } from './types'

/**
 * Orders findings by source, then line, then character.
 *
 * Sorting by position alone interleaves findings from different files once a run
 * spans multiple sources; grouping by `source` first keeps each file's findings
 * contiguous. The runner and the lint pipeline both sort — the runner over the
 * rule results, the pipeline over those merged with parser and resolver
 * diagnostics — and they have to agree, so they share this comparator rather
 * than each carrying a copy.
 */
export const bySourceThenPosition = (a: IDiagnostic, b: IDiagnostic): number => {
  const sourceA = a.source ?? ''
  const sourceB = b.source ?? ''
  if (sourceA !== sourceB) return sourceA < sourceB ? -1 : 1
  return a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character
}
