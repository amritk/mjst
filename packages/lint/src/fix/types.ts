import type { IDiagnostic, JsonPath } from '../core/types'
import type { EditOp, ParserFormat } from '../parsers'

export type { EditOp, ParserFormat }

/** What a {@link Fixer} is handed for a single finding it might repair. */
export type FixContext = {
  /** The finding to fix. */
  diagnostic: IDiagnostic
  /** The parsed, *unresolved* document data — fixers read the real node to derive the edit. */
  data: unknown
  /** The document's format, in case a fixer needs to vary its output. */
  format: ParserFormat
}

/**
 * A repair for the findings of one rule. `fix` inspects the finding (and the
 * underlying data) and returns the structural edit(s) that resolve it, or
 * `undefined` if it can't. `safe` marks whether the fix is semantics-preserving
 * enough to apply automatically; `lint --fix` applies safe fixes only.
 */
export type Fixer = {
  /** Defaults to `true`. Set `false` for fixes that may change behavior (opt-in only). */
  safe?: boolean
  fix: (context: FixContext) => EditOp[] | EditOp | undefined
}

/** Fixers keyed by the rule `code` whose findings they repair. */
export type FixerRegistry = Record<string, Fixer>

/** A finding that a fixer produced edits for. */
export type AppliedFix = {
  code: string | number
  path: JsonPath
}

/** The outcome of {@link applyFixes}. */
export type FixResult = {
  /** The rewritten document text (identical to the input when nothing applied). */
  output: string
  /** The findings that were repaired. */
  applied: AppliedFix[]
  /** Whether `output` differs from the input. */
  changed: boolean
}
