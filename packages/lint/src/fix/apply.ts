import type { IDiagnostic, JsonPath } from '../core'
import { applyEditOpsWithChanges, type EditOp, type ParserFormat } from '../parsers'
import type { AppliedFix, FixerRegistry, FixResult } from './types'

/** Options for {@link applyFixes}. */
export type ApplyFixesOptions = {
  /** When true (the default), fixers marked `safe: false` are skipped. */
  safeOnly?: boolean
}

/** The ops that structurally reshape an array, invalidating positional indices into it. */
const STRUCTURAL_ARRAY_OPS = new Set<EditOp['op']>(['removeItems', 'reorderArray', 'insertItem'])

const isStructuralArrayOp = (op: EditOp): boolean => STRUCTURAL_ARRAY_OPS.has(op.op)

/**
 * Whether `path` addresses (or reaches into) an array that an earlier op in this
 * batch already reshaped. After a `removeItems`/`reorderArray`/`insertItem`, the
 * element indices of that array are stale, so a second op that either targets the
 * same array or indexes into it by position would act on the wrong element. Such
 * an op is deferred to the next fixpoint pass, which re-derives indices from the
 * freshly-parsed document.
 */
const touchesModifiedArray = (path: JsonPath, modified: JsonPath[]): boolean =>
  modified.some((array) => {
    if (array.length > path.length) return false
    if (!array.every((segment, i) => segment === path[i])) return false
    // Another structural op on the same array conflicts; a deeper op conflicts
    // only when it indexes the array by position (the stale part).
    return array.length === path.length || typeof path[array.length] === 'number'
  })

/**
 * Computes the structural edits for every fixable finding in `diagnostics`, then
 * applies them to `input` in one pass. Edits from different findings that come
 * out identical (e.g. several "not alphabetical" findings on one array all asking
 * for the same reorder) are de-duplicated so the edit is applied once.
 *
 * `data` is the *unresolved* parsed document: fixers read the real node at a
 * finding's path to derive the edit, and edits whose path no longer resolves are
 * dropped — so a finding on an inlined `$ref` node simply isn't fixed rather than
 * corrupting the source.
 *
 * When two ops in one batch would both reshape the same array, only the first is
 * applied this pass; the second is *deferred* and its finding is left unreported,
 * so the surrounding fixpoint loop re-derives it against the already-edited
 * document (where the indices are fresh) on the next pass. A finding is reported
 * in `applied` only when *every* edit it contributed actually changed the text —
 * a partially-applied or deferred fix is retried rather than falsely counted.
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

  // Gather each candidate finding's ops up front so we can reason about conflicts
  // across the whole batch before lowering anything to text.
  const candidates: { fix: AppliedFix; ops: EditOp[] }[] = []
  for (const diagnostic of diagnostics) {
    const fixer = fixers[String(diagnostic.code)]
    if (!fixer) continue
    if (safeOnly && fixer.safe === false) continue

    const produced = fixer.fix({ diagnostic, data, format })
    if (!produced) continue
    const ops = Array.isArray(produced) ? produced : [produced]
    if (ops.length === 0) continue
    candidates.push({ fix: { code: diagnostic.code, path: diagnostic.path }, ops })
  }

  const ops: EditOp[] = []
  const indexByKey = new Map<string, number>()
  const modifiedArrays: JsonPath[] = []
  // Per candidate: the batch index of each op that made it into this pass, and
  // whether any op had to be deferred (which keeps the finding unreported so it
  // is retried once the earlier structural edit has landed).
  const planned: { fix: AppliedFix; indices: number[]; deferred: boolean }[] = []

  for (const candidate of candidates) {
    const indices: number[] = []
    let deferred = false
    for (const op of candidate.ops) {
      const key = JSON.stringify(op)
      // De-duplicate identical edits (e.g. several findings on one array all asking
      // for the same reorder): the same edit is applied — and counted — once, and
      // is never a conflict with itself.
      const existing = indexByKey.get(key)
      if (existing !== undefined) {
        indices.push(existing)
        continue
      }
      // A distinct op that would reshape or index into an already-reshaped array
      // is deferred to the next pass, where indices are re-derived from fresh data.
      if (touchesModifiedArray(op.path, modifiedArrays)) {
        deferred = true
        continue
      }
      const index = ops.length
      indexByKey.set(key, index)
      ops.push(op)
      if (isStructuralArrayOp(op)) modifiedArrays.push(op.path)
      indices.push(index)
    }
    planned.push({ fix: candidate.fix, indices, deferred })
  }

  if (ops.length === 0) return { output: input, applied: [], changed: false }

  const { output, changed } = applyEditOpsWithChanges(input, format, ops)
  const applied = planned
    .filter((plan) => !plan.deferred && plan.indices.length > 0 && plan.indices.every((index) => changed[index]))
    .map((plan) => plan.fix)
  return { output, applied, changed: output !== input }
}
