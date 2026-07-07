import pc from 'picocolors'

import { DiagnosticSeverity, type IDiagnostic } from '../core'
import { colorize, type Formatter, SEVERITY_LABEL } from './common'

/** Groups diagnostics by their `source` so output is organized per file. */
const groupBySource = (results: IDiagnostic[]): Map<string, IDiagnostic[]> => {
  const groups = new Map<string, IDiagnostic[]>()
  for (const result of results) {
    const key = result.source ?? ''
    const list = groups.get(key) ?? []
    list.push(result)
    groups.set(key, list)
  }
  return groups
}

/** ESLint-style human-readable output, grouped per source with a summary line. */
export const stylish: Formatter = (results) => {
  if (results.length === 0) return pc.green('No problems found')
  const lines: string[] = []
  for (const [source, group] of groupBySource(results)) {
    lines.push(pc.underline(source || '<stdin>'))
    for (const r of group) {
      const pos = `${r.range.start.line + 1}:${r.range.start.character + 1}`
      lines.push(
        `  ${pos.padEnd(8)} ${colorize(r.severity, SEVERITY_LABEL[r.severity].padEnd(8))} ${r.message}  ${pc.dim(String(r.code))}`,
      )
    }
    lines.push('')
  }
  const errors = results.filter((r) => r.severity === DiagnosticSeverity.Error).length
  const warnings = results.filter((r) => r.severity === DiagnosticSeverity.Warning).length
  lines.push(pc.bold(`✖ ${results.length} problems (${errors} errors, ${warnings} warnings)`))
  return lines.join('\n')
}
