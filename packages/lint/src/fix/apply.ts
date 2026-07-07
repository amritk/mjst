import type { IDiagnostic } from '../core'
import { applyEditOpsWithChanges, type EditOp, type ParserFormat } from '../parsers'
import type { AppliedFix, FixerRegistry, FixResult } from './types'

/** Options for {@link applyFixes}. */
export type ApplyFixesOptions = {
  /** When true (the default), fixers marked `safe: false` are skipped. */
  safeOnly?: boolean
}

/**
 * Computes the structural edits for every fixable finding in `diagnostics`, then
 * applies them to `input` in one pass. Edits from different findings that come
 * out identical (e.g. several "not alphabetical" findings on one array all asking
 * for the same reorder) are de-duplicated so the edit is applied once.
 *
 * `data` is the *unresolved* parsed document: fixers read the real node at a
 * finding's path to derive the edit, and edits whose path no longer resolves are
 * dropped — so a finding on an inlined `$ref` node simply isn't fixed rather than
 * corrupting the source. A finding is only reported in `applied` when one of its
 * edits actually changed the text, so dropped edits are not mistaken for fixes.
 */
export const applyFixes = (
  input: string,
  format: ParserFormat,
  data: unknown,
  diagnostics: IDiagnostic[],
  fixers: FixerRegistry,
  options: ApplyFixesOptions = {},
): FixResult => {
  const safeOnly = options.safeOnly !== false
  const ops: EditOp[] = []
  const indexByKey = new Map<string, number>()
  // Each candidate finding remembers the edits it contributed (by key) so we can
  // tell afterwards whether any of them actually landed.
  const candidates: { fix: AppliedFix; keys: string[] }[] = []

  for (const diagnostic of diagnostics) {
    const fixer = fixers[String(diagnostic.code)]
    if (!fixer) continue
    if (safeOnly && fixer.safe === false) continue

    const produced = fixer.fix({ diagnostic, data, format })
    if (!produced) continue

    const keys: string[] = []
    for (const op of Array.isArray(produced) ? produced : [produced]) {
      const key = JSON.stringify(op)
      // De-duplicate identical edits (e.g. several findings on one array all asking
      // for the same reorder) so the edit is applied — and counted — once.
      if (!indexByKey.has(key)) {
        indexByKey.set(key, ops.length)
        ops.push(op)
      }
      keys.push(key)
    }
    if (keys.length > 0) candidates.push({ fix: { code: diagnostic.code, path: diagnostic.path }, keys })
  }

  if (ops.length === 0) return { output: input, applied: [], changed: false }

  const { output, changed } = applyEditOpsWithChanges(input, format, ops)
  const applied = candidates
    .filter((candidate) => candidate.keys.some((key) => changed[indexByKey.get(key) as number]))
    .map((candidate) => candidate.fix)
  return { output, applied, changed: output !== input }
}
