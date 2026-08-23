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
 * Drops findings that name the same problem at the same authored node: same
 * rule, severity, message, path, range and source.
 *
 * A rule with `resolved: true` walks the dereferenced tree, where one reusable
 * `components` entry appears once per `$ref` reaching it *and* once at its
 * declaration. Each copy is reported against the authored node it came from (see
 * `locate`), so the copies are identical in every field a reader sees — and the
 * second and third tell them nothing the first did not.
 *
 * The `path` is part of the key, and load-bearing. Ranges alone do not identify
 * a node: `getLocationForJsonPath` falls back to the closest existing ancestor,
 * so findings about *absent* sibling fields — `info.contact` missing `name`,
 * `url` and `email` — all carry the enclosing object's range. They are three
 * distinct problems and keep three distinct paths, so they survive. An earlier
 * version of this keyed on the range alone and collapsed them into one.
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
      // Segments are joined with a character a JSON key cannot contain
      // unescaped, so `['a.b']` and `['a','b']` do not collide.
      diagnostic.path.map(String).join('\u0000'),
      diagnostic.message,
    ].join('\u0001')
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(diagnostic)
  }
  return kept
}
