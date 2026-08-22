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

/**
 * Drops findings that are indistinguishable from one already kept: same rule,
 * same severity, same message, same range, same source.
 *
 * A rule with `resolved: true` walks the dereferenced tree, where one reusable
 * `components` entry appears once per `$ref` that reaches it *and* once at its
 * declaration. Every copy maps back through the source map to the same node, so
 * one authored mistake in a message used twice produced three findings at
 * byte-identical `line:column` with byte-identical text. There is nothing a
 * reader can do with the second and third.
 *
 * Deliberately keyed on what a reader sees rather than on the internal `path`:
 * two findings differing only in the path they were reached by are the same
 * finding as far as the report is concerned. Anything differing in rule,
 * wording, severity or position is kept — this collapses duplicates, never
 * distinct findings.
 */
export const withoutDuplicates = (diagnostics: readonly IDiagnostic[]): IDiagnostic[] => {
  const seen = new Set<string>()
  const kept: IDiagnostic[] = []
  for (const diagnostic of diagnostics) {
    const { start, end } = diagnostic.range
    const key = [
      diagnostic.source ?? '',
      String(diagnostic.code),
      diagnostic.severity,
      start.line,
      start.character,
      end.line,
      end.character,
      diagnostic.message,
    ].join(' ')
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(diagnostic)
  }
  return kept
}
