import { DiagnosticSeverity } from '../parsers'
import { ownKey } from './own-key'
import type { HumanReadableSeverity } from './types'

/**
 * The severity names a ruleset may write, and what each maps to. `off` is not a
 * level but a toggle, so it maps to the string rather than a number and each
 * caller decides what "off" means for it (a disabled rule, a dropped finding, a
 * parser check that does not run).
 *
 * One table, because there were three — in the ruleset normalizer, the runner's
 * pointer-scoped overrides, and the parser-options mapping — and a name added to
 * one of them would have been silently missing from the others.
 */
const SEVERITY_NAMES: Record<HumanReadableSeverity, DiagnosticSeverity | 'off'> = {
  error: DiagnosticSeverity.Error,
  warn: DiagnosticSeverity.Warning,
  info: DiagnosticSeverity.Information,
  hint: DiagnosticSeverity.Hint,
  off: 'off',
}

/**
 * Resolves a severity name, or `undefined` when it is not one we know.
 *
 * `ownKey`, never a bare index or `in`: these names come from rulesets, so
 * `severity: 'constructor'` otherwise resolved to `Object` itself — and a
 * severity that is a function is neither `'off'` nor `undefined`, so it sailed
 * past both fallbacks and every later comparison against
 * `DiagnosticSeverity.Error` read false.
 */
export const severityFromName = (name: string): DiagnosticSeverity | 'off' | undefined => ownKey(SEVERITY_NAMES, name)
