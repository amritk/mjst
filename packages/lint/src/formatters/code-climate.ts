import { DiagnosticSeverity, type IDiagnostic } from '../core'
import type { Formatter } from './common'

const CODE_CLIMATE_SEVERITY: Record<DiagnosticSeverity, string> = {
  [DiagnosticSeverity.Error]: 'major',
  [DiagnosticSeverity.Warning]: 'minor',
  [DiagnosticSeverity.Information]: 'info',
  [DiagnosticSeverity.Hint]: 'info',
}

/** Stable djb2 hash used as a Code Climate issue fingerprint. */
const fingerprint = (value: string): string => {
  let hash = 5381
  for (let i = 0; i < value.length; i++) hash = (hash * 33) ^ value.charCodeAt(i)
  return (hash >>> 0).toString(16)
}

const toCodeClimate = (results: IDiagnostic[]) =>
  results.map((r) => ({
    description: `${r.message} (${r.code})`,
    check_name: String(r.code),
    fingerprint: fingerprint(`${r.source ?? ''}:${r.code}:${r.path.join('/')}:${r.range.start.line}`),
    severity: CODE_CLIMATE_SEVERITY[r.severity],
    location: { path: r.source ?? '', lines: { begin: r.range.start.line + 1 } },
  }))

/** Code Climate / GitLab Code Quality JSON report. */
export const codeClimate: Formatter = (results) => JSON.stringify(toCodeClimate(results), null, 2)
