import pc from 'picocolors'

import { DiagnosticSeverity, type IDiagnostic } from '../core'

/** Renders a set of diagnostics into a single string in a specific output format. */
export type Formatter = (results: IDiagnostic[]) => string

/** Human-readable label for each severity, used across the text-oriented formatters. */
export const SEVERITY_LABEL: Record<DiagnosticSeverity, string> = {
  [DiagnosticSeverity.Error]: 'error',
  [DiagnosticSeverity.Warning]: 'warning',
  [DiagnosticSeverity.Information]: 'information',
  [DiagnosticSeverity.Hint]: 'hint',
}

/** Colors `text` by severity for terminal output (red/yellow/cyan). */
export const colorize = (severity: DiagnosticSeverity, text: string): string => {
  switch (severity) {
    case DiagnosticSeverity.Error:
      return pc.red(text)
    case DiagnosticSeverity.Warning:
      return pc.yellow(text)
    default:
      return pc.cyan(text)
  }
}

/** Escapes the five XML special characters for the junit/html formatters. */
export const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
