import { DiagnosticSeverity } from '@amritk/lint-core'

import type { Formatter } from './common'

/** GitHub Actions workflow commands map errors/warnings to annotations, the rest to notices. */
const GH_COMMAND: Record<DiagnosticSeverity, string> = {
  [DiagnosticSeverity.Error]: 'error',
  [DiagnosticSeverity.Warning]: 'warning',
  [DiagnosticSeverity.Information]: 'notice',
  [DiagnosticSeverity.Hint]: 'notice',
}

/** GitHub Actions annotation workflow commands (`::error file=…`). */
export const githubActions: Formatter = (results) =>
  results
    .map((r) => {
      const file = r.source ?? ''
      const line = r.range.start.line + 1
      const col = r.range.start.character + 1
      return `::${GH_COMMAND[r.severity]} file=${file},line=${line},col=${col}::${r.message} (${r.code})`
    })
    .join('\n')
