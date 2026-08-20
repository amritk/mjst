import { DiagnosticSeverity } from '../parsers'
import type { Format } from './formats'
import { matchesGlob } from './glob'
import { compileQuery } from './jsonpath'
import { ownKey, setOwnKey } from './own-key'
import { severityFromName } from './severity'
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

const parseSeverity = (
  value: DiagnosticSeverity | HumanReadableSeverity | undefined,
): { severity: DiagnosticSeverity; enabled: boolean } => {
  if (value === undefined) return { severity: DiagnosticSeverity.Warning, enabled: true }
  if (typeof value === 'number') return { severity: value, enabled: true }
  const mapped = severityFromName(value)
  if (mapped === 'off') return { severity: DiagnosticSeverity.Warning, enabled: false }
  // An unrecognized severity string (e.g. "warning" instead of "warn") is a
  // ruleset authoring mistake. We fall back to Warning and keep the rule enabled
  // rather than silently producing findings with an `undefined` severity;
  // `validateRuleset` surfaces the same string loudly as a validation problem.
  if (mapped === undefined) return { severity: DiagnosticSeverity.Warning, enabled: true }
  return { severity: mapped, enabled: true }
}

const toArray = <T>(value: T | T[]): T[] => (Array.isArray(value) ? value : [value])

/** True for the object shape a full rule definition takes (so not `null`, and not an array). */
const isRuleDefinition = (entry: unknown): entry is IRuleDefinition =>
  typeof entry === 'object' && entry !== null && !Array.isArray(entry)

/**
 * Rejects a `rules` entry that is none of the shapes a ruleset may write, naming
 * the rule. Every one of these used to reach {@link normalizeRule} and fail deep
 * inside it — a YAML rule written `my-rule:` with no body is `null`, and the
 * author was told "Cannot read properties of null (reading 'severity')".
 */
const assertRuleEntry: (name: string, entry: unknown) => asserts entry is RuleEntry = (name, entry) => {
  if (typeof entry === 'boolean' || typeof entry === 'number' || typeof entry === 'string') return
  if (isRuleDefinition(entry)) return
  const kind = entry === null ? 'null' : Array.isArray(entry) ? 'an array' : `\`${typeof entry}\``
  throw new Error(`Rule "${name}" must be a rule definition, a boolean, or a severity — got ${kind}`)
}

/**
 * Checks a rule's `given` expressions at build time so a broken one is loud here
 * rather than silently matching nothing (or the root) at run time. Alias
 * references are validated when they are expanded against document formats.
 */
const assertGiven = (name: string, given: unknown[]): void => {
  if (given.length === 0) throw new Error(`Rule "${name}" is missing \`given\``)
  for (const expression of given) {
    if (typeof expression !== 'string') {
      const kind = expression === null ? 'null' : `\`${typeof expression}\``
      throw new Error(`Rule "${name}" has an invalid \`given\`: expected a JSONPath string, got ${kind}`)
    }
    if (expression.startsWith('#')) continue
    const compiled = compileQuery(expression)
    if (compiled.error !== undefined) {
      throw new Error(`Rule "${name}" has an invalid \`given\` "${expression}": ${compiled.error}`)
    }
  }
}

/**
 * The ruleset-level context a rule inherits from the definition that declares
 * it: default `formats` (finding: ruleset-level formats stamp onto rules lacking
 * their own) and a `documentationUrl` base (each rule gets `${base}#${name}`).
 */
type DeclaringContext = {
  formats?: string[] | undefined
  documentationUrl?: string | undefined
}

const normalizeRule = (
  name: string,
  def: IRuleDefinition,
  modifier: ExtendModifier,
  declaring: DeclaringContext = {},
): ResolvedRule => {
  const { severity, enabled } = parseSeverity(def.severity)
  const recommended = def.recommended ?? true
  // Under the 'recommended' modifier only recommended rules are on; 'all' turns
  // everything on; 'off' turns everything off.
  const modifierEnabled = modifier === 'off' ? false : modifier === 'recommended' ? recommended : true
  // A rule without its own `formats` inherits the declaring ruleset's, so a
  // ruleset-level `formats` actually gates its rules (matching Spectral).
  const formats = def.formats ?? declaring.formats
  // Derive a per-rule docs anchor from the declaring ruleset's `documentationUrl`.
  const documentationUrl =
    def.documentationUrl ?? (declaring.documentationUrl ? `${declaring.documentationUrl}#${name}` : undefined)
  return {
    name,
    description: def.description,
    message: def.message,
    severity,
    enabled: enabled && modifierEnabled,
    // `?? []` so a definition missing either field normalizes to "nothing to do"
    // instead of a one-element `[undefined]` that blows up further downstream;
    // `assertGiven` is what reports a missing `given` as the authoring error it is.
    given: toArray(def.given ?? []),
    then: toArray(def.then ?? []),
    formats: formats ? new Set(formats) : undefined,
    recommended,
    resolved: def.resolved ?? true,
    documentationUrl,
  }
}

/**
 * Applies a shorthand entry (a boolean toggle or a severity string) to an
 * existing rule. When `throwOnMissing` is set (the `extends`/merge path), a
 * shorthand for a rule that does not exist anywhere is an error — Spectral
 * rejects "Cannot extend non-existing rule". Overrides pass it unset so a
 * per-file toggle for an absent rule is simply ignored at run time.
 */
const applyEntry = (rules: Map<string, ResolvedRule>, name: string, entry: RuleEntry, throwOnMissing = false): void => {
  assertRuleEntry(name, entry)
  if (typeof entry === 'boolean') {
    const existing = rules.get(name)
    if (existing) existing.enabled = entry
    else if (throwOnMissing) throw new Error(`Cannot extend non-existing rule "${name}"`)
    return
  }
  // A severity, spelled either as a name or as the numeric LSP level — overrides
  // are documented to accept both, and only the pointer-scoped path understood
  // the numeric form before.
  if (typeof entry === 'string' || typeof entry === 'number') {
    const existing = rules.get(name)
    if (!existing) {
      if (throwOnMissing) throw new Error(`Cannot extend non-existing rule "${name}"`)
      return
    }
    const { severity, enabled } = parseSeverity(entry)
    existing.severity = severity
    existing.enabled = enabled
    return
  }
  // Full definition: define or replace (always enabled per its own severity).
  rules.set(name, normalizeRule(name, entry, 'all'))
}

/**
 * The mutable state threaded through a merge: the accumulating rule map, the
 * `seen` set that breaks `extends` cycles, the merged alias table, and the
 * merged parser options. See {@link createRuleset}.
 */
type MergeContext = {
  into: Map<string, ResolvedRule>
  resolve: ExtendResolver | undefined
  seen: Set<unknown>
  aliases: Record<string, AliasDefinition>
  parserOptions: NonNullable<RulesetDefinition['parserOptions']>
}

/**
 * Resolves an alias name used by a rule against the aliases in scope for the
 * *declaring* definition, registering it in the merged table and returning the
 * key to reference it by. Colliding names from different rulesets are kept apart
 * under a suffixed key so an inherited rule keeps using its own ruleset's alias.
 * Throws when the alias is not defined, matching Spectral.
 */
const registerAlias = (
  ctx: MergeContext,
  declaringAliases: Record<string, AliasDefinition>,
  name: string,
  ruleName: string,
): string => {
  // `Object.hasOwn` on every read here, not just at lookup time: the alias
  // grammar accepts `#constructor`, and a bare index answered it from
  // `Object.prototype` with something truthy — so the "references undefined
  // alias" throw was skipped and `Object` was written into the table as a real
  // own key. The guard `resolveAlias` has could not help after that: the name
  // *was* own, and the missing `.targets` threw out of the whole lint run.
  const alias = ownKey(declaringAliases, name)
  if (!alias) throw new Error(`Rule "${ruleName}" references undefined alias "#${name}"`)
  const existing = ownKey(ctx.aliases, name)
  if (existing === undefined || existing === alias) {
    setOwnKey(ctx.aliases, name, alias)
    return name
  }
  // Name collision with a different alias from another ruleset — scope it.
  for (let n = 0; ; n++) {
    const key = `${name}__${n}`
    const at = ownKey(ctx.aliases, key)
    if (at === undefined || at === alias) {
      setOwnKey(ctx.aliases, key, alias)
      return key
    }
  }
}

const ALIAS_REFERENCE = /^#([A-Za-z0-9_-]+)(.*)$/

/** Rewrites `#Alias` references in a rule's `given` to the merged alias keys in scope. */
const rewriteGiven = (
  ctx: MergeContext,
  declaringAliases: Record<string, AliasDefinition>,
  ruleName: string,
  given: string[],
): string[] =>
  given.map((expression) => {
    const match = ALIAS_REFERENCE.exec(expression)
    if (!match) return expression
    const key = registerAlias(ctx, declaringAliases, match[1] as string, ruleName)
    return `#${key}${match[2] ?? ''}`
  })

const collectExtends = (
  extendsValue: RulesetExtends,
  defaultModifier: ExtendModifier,
  basePath: string,
  ctx: MergeContext,
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
      // Key the edge by (basePath, reference) so a cycle in the extends graph is
      // detected even though each file load returns a fresh object.
      const key = `${basePath}\0${target}`
      if (ctx.seen.has(key)) continue
      ctx.seen.add(key)
      // A resolved file/package brings its own base directory for any nested extends.
      const resolved = resolveNamed(target, ctx.resolve, basePath)
      // The modifier applied to this target also cascades to its own extends, so
      // an `all`/`off` extend reaches transitively-extended bases too.
      mergeInto(resolved.definition, modifier, modifier, resolved.basePath, ctx)
    } else {
      if (ctx.seen.has(target)) continue
      ctx.seen.add(target)
      mergeInto(target, modifier, modifier, basePath, ctx)
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
  extendsModifier: ExtendModifier,
  basePath: string,
  ctx: MergeContext,
): void => {
  if (definition.extends) {
    // `extendsModifier` is the default this definition's own extends cascade
    // with. For an extended ruleset it equals its own modifier (so `all`/`off`
    // reach transitively-extended bases); for the root ruleset it is
    // `recommended`, so a plain top-level `extends` enables only recommended
    // rules even though the root's own rules are all on.
    collectExtends(definition.extends, extendsModifier, basePath, ctx)
  }
  const declaring: DeclaringContext = {
    formats: definition.formats,
    documentationUrl: definition.documentationUrl,
  }
  if (definition.rules) {
    for (const [name, entry] of Object.entries(definition.rules)) {
      // `isRuleDefinition`, not `typeof entry === 'object'`: `null` is an object.
      if (isRuleDefinition(entry)) {
        const rule = normalizeRule(name, entry, modifier, declaring)
        rule.given = rewriteGiven(ctx, definition.aliases ?? {}, name, rule.given)
        ctx.into.set(name, rule)
      } else {
        applyEntry(ctx.into, name, entry, true)
      }
    }
  }
  // Parser options thread up from extended bases; the current (outer) definition
  // wins, so it is merged after the extends have contributed theirs.
  if (definition.parserOptions) Object.assign(ctx.parserOptions, definition.parserOptions)
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
  const overrides = definition.overrides ?? []
  const ctx: MergeContext = {
    into: new Map<string, ResolvedRule>(),
    resolve: options.resolve,
    // Seed the cycle guard with the root definition so a self-reference is caught.
    seen: new Set<unknown>([definition]),
    // Seed the alias table with the root definition's aliases under their own
    // names so a directly-authored `#Alias` given (and the public `expandGiven`)
    // keeps working unchanged.
    aliases: { ...((definition.aliases ?? {}) as Record<string, AliasDefinition>) },
    parserOptions: {},
  }
  // The root's own rules are all enabled ('all'), but a plain `extends` on it
  // still contributes only recommended rules ('recommended' cascade).
  mergeInto(definition, 'all', 'recommended', options.basePath ?? process.cwd(), ctx)
  const rules = [...ctx.into.values()]
  const aliases = ctx.aliases

  for (const rule of rules) assertGiven(rule.name, rule.given)
  // Overrides are applied per document, long after this point, so their entries
  // are checked here too — a malformed one used to surface as a TypeError from
  // the middle of a lint run instead of as a ruleset error at build time.
  for (const override of overrides) {
    if (!override.rules) continue
    for (const [name, entry] of Object.entries(override.rules)) {
      assertRuleEntry(name, entry)
      if (isRuleDefinition(entry)) assertGiven(name, toArray(entry.given ?? []))
    }
  }

  const resolveAlias = (name: string, documentFormats: Set<string>): string[] => {
    // `Object.hasOwn`, as with `getFunction` below: alias names come from the
    // ruleset, and a bare index answered `#constructor` with `Object` — not an
    // array, and with no `.targets`, so the loop below threw out of the whole
    // lint run. An alias that is merely unknown returns `[]`.
    const alias = ownKey(aliases, name)
    if (!alias) return []
    if (Array.isArray(alias)) return alias
    for (const target of alias.targets) {
      if (target.formats.some((format) => documentFormats.has(format))) return target.given
    }
    return []
  }

  const hasOverrides = overrides.length > 0
  const parserOptions = Object.keys(ctx.parserOptions).length > 0 ? ctx.parserOptions : definition.parserOptions

  return {
    rules,
    functions,
    formats,
    aliases,
    overrides,
    parserOptions,
    enabledRules: rules.filter((rule) => rule.enabled),
    // `Object.hasOwn`, not a bare index: `then.function` is ruleset input, so
    // `"toString"` otherwise resolved to `Function.prototype.toString` and ran
    // as a rule function instead of being reported as unknown — its string
    // return value then read as an iterable of per-character diagnostics.
    getFunction: (name) => ownKey(functions, name),
    rulesForSource: (source) => {
      if (!source || !hasOverrides) return rules
      // Only pay for a clone when an override actually matches this source; the
      // common case (overrides exist but none match) returns the shared rules.
      const matching = overrides.filter((override) => {
        if (!override.rules) return false
        // Pointer-scoped entries (`file#/path`) are applied per-finding, not here.
        const patterns = override.files.filter((file) => !file.includes('#'))
        return patterns.length > 0 && matchesGlob(source, patterns)
      })
      if (matching.length === 0) return rules
      const scoped = new Map(rules.map((rule) => [rule.name, cloneRule(rule)]))
      for (const override of matching) {
        for (const [name, entry] of Object.entries(override.rules as Record<string, RuleEntry>)) {
          applyEntry(scoped, name, entry)
        }
      }
      return [...scoped.values()]
    },
    expandGiven: (given, documentFormats) => {
      const out: string[] = []
      for (const expression of given) {
        const match = ALIAS_REFERENCE.exec(expression)
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
