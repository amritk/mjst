import { DiagnosticSeverity } from '../core'
import type { Formatter } from './common'

const TEAMCITY_SEVERITY: Record<DiagnosticSeverity, string> = {
  [DiagnosticSeverity.Error]: 'ERROR',
  [DiagnosticSeverity.Warning]: 'WARNING',
  [DiagnosticSeverity.Information]: 'INFO',
  [DiagnosticSeverity.Hint]: 'INFO',
}

/** Escapes TeamCity service-message special characters. */
const teamcityEscape = (value: string): string =>
  value.replace(/\|/g, '||').replace(/'/g, "|'").replace(/\n/g, '|n').replace(/\[/g, '|[').replace(/\]/g, '|]')

/** TeamCity service messages, one `##teamcity[message …]` per finding. */
export const teamcity: Formatter = (results) =>
  results
    .map((r) => {
      const file = teamcityEscape(r.source ?? '')
      const message = teamcityEscape(`${r.message} (${r.code})`)
      return `##teamcity[message text='${message}' errorDetails='${file}:${r.range.start.line + 1}' status='${TEAMCITY_SEVERITY[r.severity]}']`
    })
    .join('\n')
