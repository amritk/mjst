import { DiagnosticSeverity } from '../parsers'
import type { Format } from './formats'
import { matchesGlob } from './glob'
import type {
  FunctionRegistry,
  HumanReadableSeverity,
  IRuleDefinition,
  IRulesetOverride,
  ResolvedRule,
  RuleEntry,
  RulesetDefinition,
  RulesetExtends,
  RulesetFunction,
} from './types'

/** Controls which rules an `extends` target contributes: everything, only recommended, or none. */
export type ExtendModifier = 'all' | 'recommended' | 'off'

/** A ruleset resolved from an `extends` reference, plus the base directory its own extends resolve from. */
export type ResolvedExtend = {
  definition: RulesetDefinition
  basePath: string
}

/**
 * Resolves a string `extends` target (a built-in name, file path, or npm package)
 * to a ruleset definition. `basePath` is the directory the reference is relative to.
 */
export type ExtendResolver = (name: string, basePath: string) => ResolvedExtend

/** An alias target: either a flat list of `given`s, or per-format `given`s with an optional description. */
export type AliasDefinition = string[] | { description?: string; targets: { formats: string[]; given: string[] }[] }

const SEVERITY_NAMES: Record<HumanReadableSeverity, DiagnosticSeverity | 'off'> = {
  error: DiagnosticSeverity.Error,
  warn: DiagnosticSeverity.Warning,
  info: DiagnosticSeverity.Information,
  hint: DiagnosticSeverity.Hint,
  off: 'off',
}

const parseSeverity = (
  value: DiagnosticSeverity | HumanReadableSeverity | undefined,
): { severity: DiagnosticSeverity; enabled: boolean } => {
  if (value === undefined) return { severity: DiagnosticSeverity.Warning, enabled: true }
  if (typeof value === 'number') return { severity: value, enabled: true }
  const mapped = SEVERITY_NAMES[value]
  if (mapped === 'off') return { severity: DiagnosticSeverity.Warning, enabled: false }
  return { severity: mapped, enabled: true }
}

const toArray = <T>(value: T | T[]): T[] => (Array.isArray(value) ? value : [value])

const normalizeRule = (name: string, def: IRuleDefinition, modifier: ExtendModifier): ResolvedRule => {
  const { severity, enabled } = parseSeverity(def.severity)
  const recommended = def.recommended ?? true
  // Under the 'recommended' modifier only recommended rules are on; 'all' turns
  // everything on; 'off' turns everything off.
  const modifierEnabled = modifier === 'off' ? false : modifier === 'recommended' ? recommended : true
  return {
    name,
    description: def.description,
    message: def.message,
    severity,
    enabled: enabled && modifierEnabled,
    given: toArray(def.given),
    then: toArray(def.then),
    formats: def.formats ? new Set(def.formats) : undefined,
    recommended,
    resolved: def.resolved ?? true,
    documentationUrl: def.documentationUrl,
  }
}

const applyEntry = (rules: Map<string, ResolvedRule>, name: string, entry: RuleEntry): void => {
  if (typeof entry === 'boolean') {
    const existing = rules.get(name)
    if (existing) existing.enabled = entry
    return
  }
  if (typeof entry === 'string') {
    const existing = rules.get(name)
    const { severity, enabled } = parseSeverity(entry)
    if (existing) {
      existing.severity = severity
      existing.enabled = enabled
    }
    return
  }
  // Full definition: define or replace (always enabled per its own severity).
  rules.set(name, normalizeRule(name, entry, 'all'))
}

const collectExtends = (
  extendsValue: RulesetExtends,
  defaultModifier: ExtendModifier,
  resolve: ExtendResolver | undefined,
  into: Map<string, ResolvedRule>,
  basePath: string,
): void => {
  const entries = Array.isArray(extendsValue) ? extendsValue : [extendsValue]
  for (const entry of entries) {
    let target: string | RulesetDefinition
    let modifier = defaultModifier
    if (Array.isArray(entry)) {
      target = entry[0]
      modifier = entry[1]
    } else {
      target = entry
    }
    if (typeof target === 'string') {
      // A resolved file/package brings its own base directory for any nested extends.
      const resolved = resolveNamed(target, resolve, basePath)
      mergeInto(resolved.definition, modifier, resolve, into, resolved.basePath)
    } else {
      mergeInto(target, modifier, resolve, into, basePath)
    }
  }
}

const resolveNamed = (name: string, resolve: ExtendResolver | undefined, basePath: string): ResolvedExtend => {
  if (!resolve) throw new Error(`Cannot resolve extended ruleset "${name}": no resolver provided`)
  return resolve(name, basePath)
}

const mergeInto = (
  definition: RulesetDefinition,
  modifier: ExtendModifier,
  resolve: ExtendResolver | undefined,
  into: Map<string, ResolvedRule>,
  basePath: string,
): void => {
  if (definition.extends) {
    collectExtends(definition.extends, 'recommended', resolve, into, basePath)
  }
  if (definition.rules) {
    for (const [name, entry] of Object.entries(definition.rules)) {
      if (typeof entry === 'object') {
        into.set(name, normalizeRule(name, entry, modifier))
      } else {
        applyEntry(into, name, entry)
      }
    }
  }
}

const cloneRule = (rule: ResolvedRule): ResolvedRule => ({
  ...rule,
  given: [...rule.given],
  then: [...rule.then],
  formats: rule.formats ? new Set(rule.formats) : undefined,
})

/** Inputs {@link createRuleset} needs beyond the definition: functions, formats, and how to resolve `extends`. */
export type RulesetOptions = {
  functions?: FunctionRegistry
  formats?: Record<string, Format>
  resolve?: ExtendResolver
  /** Directory that string `extends` references resolve relative to. Defaults to the cwd. */
  basePath?: string
}

/**
 * A normalized ruleset: every `extends`, severity override, and modifier already
 * applied, exposing the helpers the runner needs to evaluate it against a
 * document. Produced by {@link createRuleset}.
 */
export type Ruleset = {
  readonly rules: ResolvedRule[]
  readonly functions: FunctionRegistry
  readonly formats: Record<string, Format>
  readonly aliases: Record<string, AliasDefinition>
  readonly overrides: IRulesetOverride[]
  readonly parserOptions: RulesetDefinition['parserOptions']
  /** The subset of `rules` that are enabled. */
  readonly enabledRules: ResolvedRule[]
  getFunction(name: string): RulesetFunction | undefined
  /** Returns the effective rules for a document, applying matching overrides by file glob. */
  rulesForSource(source: string | undefined): ResolvedRule[]
  /** Resolves `#alias` references in `given` expressions for the document's formats. */
  expandGiven(given: string[], formats: Set<string>): string[]
}

/** Normalizes a ruleset definition into a {@link Ruleset} ready to run. */
export const createRuleset = (definition: RulesetDefinition, options: RulesetOptions = {}): Ruleset => {
  const functions = options.functions ?? {}
  const formats = options.formats ?? {}
  const aliases = (definition.aliases ?? {}) as Record<string, AliasDefinition>
  const overrides = definition.overrides ?? []
  const map = new Map<string, ResolvedRule>()
  mergeInto(definition, 'all', options.resolve, map, options.basePath ?? process.cwd())
  const rules = [...map.values()]

  const resolveAlias = (name: string, documentFormats: Set<string>): string[] => {
    const alias = aliases[name]
    if (!alias) return []
    if (Array.isArray(alias)) return alias
    for (const target of alias.targets) {
      if (target.formats.some((format) => documentFormats.has(format))) return target.given
    }
    return []
  }

  return {
    rules,
    functions,
    formats,
    aliases,
    overrides,
    parserOptions: definition.parserOptions,
    enabledRules: rules.filter((rule) => rule.enabled),
    getFunction: (name) => functions[name],
    rulesForSource: (source) => {
      if (!source || overrides.length === 0) return rules
      const scoped = new Map(rules.map((rule) => [rule.name, cloneRule(rule)]))
      for (const override of overrides) {
        // Pointer-scoped entries (`file#/path`) are applied per-finding, not here.
        const patterns = override.files.filter((file) => !file.includes('#'))
        if (patterns.length === 0 || !matchesGlob(source, patterns)) continue
        if (override.rules) {
          for (const [name, entry] of Object.entries(override.rules)) applyEntry(scoped, name, entry)
        }
      }
      return [...scoped.values()]
    },
    expandGiven: (given, documentFormats) => {
      const out: string[] = []
      for (const expression of given) {
        const match = /^#([A-Za-z0-9_-]+)(.*)$/.exec(expression)
        if (match) {
          const aliasName = match[1] as string
          const rest = match[2] ?? ''
          for (const base of resolveAlias(aliasName, documentFormats)) out.push(base + rest)
          continue
        }
        out.push(expression)
      }
      return out
    },
  }
}
