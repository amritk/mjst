import { DiagnosticSeverity } from '@amritk/lint-core'

import type { Formatter } from './common'

const SARIF_LEVEL: Record<DiagnosticSeverity, string> = {
  [DiagnosticSeverity.Error]: 'error',
  [DiagnosticSeverity.Warning]: 'warning',
  [DiagnosticSeverity.Information]: 'note',
  [DiagnosticSeverity.Hint]: 'note',
}

/** SARIF 2.1.0 log, consumable by code-scanning tools (e.g. GitHub). */
export const sarif: Formatter = (results) => {
  const rules = new Map<string, { id: string }>()
  for (const r of results) rules.set(String(r.code), { id: String(r.code) })
  const sarifLog = {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: { driver: { name: 'lint', rules: [...rules.values()] } },
        results: results.map((r) => ({
          ruleId: String(r.code),
          level: SARIF_LEVEL[r.severity],
          message: { text: r.message },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: r.source ?? '' },
                region: {
                  startLine: r.range.start.line + 1,
                  startColumn: r.range.start.character + 1,
                  endLine: r.range.end.line + 1,
                  endColumn: r.range.end.character + 1,
                },
              },
            },
          ],
        })),
      },
    ],
  }
  return JSON.stringify(sarifLog, null, 2)
}
