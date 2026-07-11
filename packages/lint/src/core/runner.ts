import type { IRange, JsonPath } from '../parsers'
import type { Document } from './document'
import { detectFormats } from './formats'
import { matchesGlob } from './glob'
import { type CompiledPath, compileQuery, query, queryMany } from './jsonpath'
import { pointerToPath, resolveSourcePath } from './pointers'
import type { Ruleset } from './ruleset'
import {
  DiagnosticSeverity,
  type IDiagnostic,
  type IFunctionResult,
  type ISourceDocument,
  type ISourceSet,
  type IThen,
  type ResolvedRule,
} from './types'

const SEVERITY_NAMES: Record<string, DiagnosticSeverity> = {
  error: DiagnosticSeverity.Error,
  warn: DiagnosticSeverity.Warning,
  info: DiagnosticSeverity.Information,
  hint: DiagnosticSeverity.Hint,
}

const ZERO_RANGE: IRange = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }

type Target = {
  value: unknown
  path: JsonPath
}

const isIndexable = (value: unknown): value is Record<string, unknown> | unknown[] =>
  typeof value === 'object' && value !== null

const isThenable = (value: unknown): value is Promise<unknown> =>
  typeof (value as { then?: unknown } | null)?.then === 'function'

/**
 * Narrows a matched value to the nodes a `then` runs against, mirroring
 * Spectral's `getLintTargets`. Both objects and arrays are indexable containers,
 * so `@key` yields keys/indices and a numeric field indexes into an array; a
 * field against a primitive lints the matched value itself; a `$`-prefixed field
 * runs as a sub-query.
 */
const resolveTargets = (value: unknown, path: JsonPath, field: string | undefined): Target[] => {
  if (field === undefined) return [{ value, path }]
  // A field only narrows into a container; against a primitive (or null) the
  // matched value itself is the target.
  if (!isIndexable(value)) return [{ value, path }]
  if (field === '@key') {
    // Object.keys over an array yields its indices (as strings); normalize those
    // back to numbers for the path so lookups stay consistent.
    return Object.keys(value).map((key) => ({
      value: key,
      path: [...path, Array.isArray(value) ? Number(key) : key],
    }))
  }
  if (field.startsWith('$')) {
    return query(value, field).map((match) => ({ value: match.value, path: [...path, ...match.path] }))
  }
  // A plain property name, or a numeric index into an array.
  const key = Array.isArray(value) && /^\d+$/.test(field) ? Number(field) : field
  return [{ value: (value as Record<string | number, unknown>)[key], path: [...path, key] }]
}

const stringify = (value: unknown): string => {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

const applyTemplate = (
  template: string,
  ctx: { property: unknown; value: unknown; path: string; error: string; description: string },
): string =>
  template.replace(/\{\{([^}]+)\}\}/g, (_match, raw: string) => {
    const key = raw.trim() as keyof typeof ctx
    return key in ctx ? stringify(ctx[key]) : ''
  })

/** Optional inputs to a runner's `run`: the dereferenced tree and its source documents. */
export type IRunOptions = {
  /** Dereferenced document data, used by rules with `resolved: true`. */
  resolved?: unknown
  /**
   * The source documents that fed the resolved tree, keyed by absolute location.
   * When provided, findings on nodes inlined from external (`$ref`'d) files map
   * back to that file's own line:column and `source` instead of the `$ref` site
   * in the root document. Omit for in-memory / internal-only resolution.
   */
  sources?: ISourceSet
}

/** Evaluates a normalized ruleset against a document. Produced by {@link createLinter}. */
export type Linter = {
  /**
   * Runs the ruleset over `document`. Async because a rule function may return a
   * Promise (Spectral-style async functions); synchronous functions resolve
   * immediately.
   */
  run(document: Document, options?: IRunOptions): Promise<IDiagnostic[]>
}

/** Resolves where a finding's `path` maps to in the source: its range and originating `source`. */
const locate = (
  rule: ResolvedRule,
  path: JsonPath,
  document: Document,
  sources: ISourceSet | undefined,
): { range: IRange; source: string | undefined } => {
  // A resolved finding may sit on a node inlined from another file. With a source
  // set, follow the `$ref` chain across documents so the range and `source` point
  // at the originating file; otherwise fall back to the root document, following
  // internal `$ref`s only.
  let originDocument: ISourceDocument = document
  let sourcePath: JsonPath
  if (rule.resolved && sources) {
    const origin = sources.origin(path)
    originDocument = sources.get(origin.location) ?? document
    sourcePath = origin.path
  } else {
    sourcePath = rule.resolved ? resolveSourcePath(document.data, path) : path
  }
  const location = originDocument.getLocationForJsonPath(sourcePath, true)
  return { range: location?.range ?? ZERO_RANGE, source: originDocument.source }
}

/** Builds an error-severity diagnostic (a failed rule function or an unknown-function reference). */
const errorDiagnostic = (
  rule: ResolvedRule,
  path: JsonPath,
  message: string,
  range: IRange,
  source: string | undefined,
): IDiagnostic => {
  const diagnostic: IDiagnostic = {
    code: rule.name,
    message,
    path,
    severity: DiagnosticSeverity.Error,
    range,
  }
  if (source !== undefined) diagnostic.source = source
  return diagnostic
}

/** Returns the name of the first `then` function this rule references that is not registered. */
const missingFunction = (ruleset: Ruleset, rule: ResolvedRule): string | undefined => {
  for (const then of rule.then) {
    if (typeof then?.function === 'string' && !ruleset.getFunction(then.function)) return then.function
  }
  return undefined
}

/**
 * Builds a deduped query plan for `rules` against `data`: each distinct
 * (expanded) `given` is compiled and evaluated once, then its matches fan out to
 * every rule that shares it. Recursive descents are evaluated with a single
 * shared tree walk inside `queryMany`.
 *
 * A rule that references an unknown named function is reported once (not per
 * node) and skipped; a rule function that throws (or rejects) becomes an
 * error-severity diagnostic on that node so one bad rule cannot abort the run.
 */
const runPlan = async (
  ruleset: Ruleset,
  rules: ResolvedRule[],
  data: unknown,
  document: Document,
  formats: Set<string>,
  out: IDiagnostic[],
  sources: ISourceSet | undefined,
): Promise<void> => {
  if (rules.length === 0) return
  const order: string[] = []
  const groups = new Map<string, { compiled: CompiledPath; rules: ResolvedRule[] }>()
  for (const rule of rules) {
    // Surface an unknown-function reference once for the whole rule, then skip it
    // rather than throwing mid-run at the first matched node.
    const missing = missingFunction(ruleset, rule)
    if (missing !== undefined) {
      out.push(
        errorDiagnostic(
          rule,
          [],
          `Rule "${rule.name}" references unknown function "${missing}"`,
          ZERO_RANGE,
          document.source,
        ),
      )
      continue
    }
    for (const given of ruleset.expandGiven(rule.given, formats)) {
      let group = groups.get(given)
      if (!group) {
        group = { compiled: compileQuery(given), rules: [] }
        groups.set(given, group)
        order.push(given)
      }
      // Guard against a rule listing the same `given` twice.
      if (group.rules[group.rules.length - 1] !== rule) group.rules.push(rule)
    }
  }

  const compiled = order.map((given) => (groups.get(given) as { compiled: CompiledPath }).compiled)
  const matchesPerGiven = queryMany(data, compiled)
  for (let i = 0; i < order.length; i++) {
    const group = groups.get(order[i] as string) as { rules: ResolvedRule[] }
    const matches = matchesPerGiven[i] as { value: unknown; path: JsonPath }[]
    for (const match of matches) {
      for (const rule of group.rules) {
        for (const then of rule.then) {
          await runThen(ruleset, rule, then, match.value, match.path, document, out, sources)
        }
      }
    }
  }
}

/** Applies `overrides` whose `files` entry includes a JSON pointer scope (`file#/path`). */
const applyScopedOverrides = (
  ruleset: Ruleset,
  source: string | undefined,
  diagnostics: IDiagnostic[],
): IDiagnostic[] => {
  if (!source) return diagnostics
  const scoped: { path: JsonPath; rules: Record<string, unknown> }[] = []
  for (const override of ruleset.overrides) {
    if (!override.rules) continue
    for (const file of override.files) {
      const hashIndex = file.indexOf('#')
      if (hashIndex === -1) continue
      const glob = file.slice(0, hashIndex)
      const path = pointerToPath(file.slice(hashIndex))
      if (path && (glob === '' || matchesGlob(source, [glob]))) {
        scoped.push({ path, rules: override.rules })
      }
    }
  }
  if (scoped.length === 0) return diagnostics

  const isPrefix = (prefix: JsonPath, path: JsonPath): boolean =>
    prefix.every((segment, index) => String(path[index]) === String(segment))

  // Note: a pointer-scoped override can *disable* (`off`/`false`) or *remap the
  // severity* of a finding under its path, but it cannot *enable* a rule — it
  // filters/adjusts findings that were already produced, so a rule turned off
  // elsewhere has no finding here to switch back on.
  const result: IDiagnostic[] = []
  for (const diagnostic of diagnostics) {
    let dropped = false
    for (const { path, rules } of scoped) {
      if (!isPrefix(path, diagnostic.path)) continue
      const entry = rules[String(diagnostic.code)]
      if (entry === undefined) continue
      if (entry === false || entry === 'off') {
        dropped = true
        break
      }
      if (typeof entry === 'number') diagnostic.severity = entry
      else if (typeof entry === 'string' && entry in SEVERITY_NAMES) {
        diagnostic.severity = SEVERITY_NAMES[entry] as DiagnosticSeverity
      }
    }
    if (!dropped) result.push(diagnostic)
  }
  return result
}

const runThen = async (
  ruleset: Ruleset,
  rule: ResolvedRule,
  then: IThen,
  value: unknown,
  path: JsonPath,
  document: Document,
  out: IDiagnostic[],
  sources: ISourceSet | undefined,
): Promise<void> => {
  // A malformed rule (e.g. a `then` with no `function`, which `validateRuleset`
  // warns about) is skipped rather than crashing the whole run.
  if (!then || (typeof then.function !== 'function' && typeof then.function !== 'string')) return
  const fn = typeof then.function === 'function' ? then.function : ruleset.getFunction(then.function)
  // Unknown named functions are handled once per rule in `runPlan`; nothing to do.
  if (!fn) return

  for (const target of resolveTargets(value, path, then.field)) {
    let results: IFunctionResult[] | undefined
    try {
      // The declared signature is synchronous, but a function reference may in
      // fact return a Promise (a Spectral-style async function), so treat the raw
      // result as unknown and await it when it is thenable.
      const raw: unknown = fn(target.value, then.functionOptions ?? {}, {
        document,
        path: target.path,
        value: target.value,
        rule,
        functionOptions: then.functionOptions,
      })
      results = (isThenable(raw) ? await raw : raw) as IFunctionResult[] | undefined
    } catch (error) {
      // Isolate the failure: convert it into an error diagnostic on this node so
      // the rest of the run (and already-collected findings) survive.
      const { range, source } = locate(rule, target.path, document, sources)
      const reason = error instanceof Error ? error.message : String(error)
      out.push(errorDiagnostic(rule, target.path, `Rule "${rule.name}" threw: ${reason}`, range, source))
      continue
    }
    if (!results) continue
    for (const result of results) {
      out.push(toDiagnostic(rule, result, target, document, sources))
    }
  }
}

const toDiagnostic = (
  rule: ResolvedRule,
  result: IFunctionResult,
  target: Target,
  document: Document,
  sources: ISourceSet | undefined,
): IDiagnostic => {
  const path = result.path ?? target.path
  const property = path.length > 0 ? path[path.length - 1] : undefined
  const message = rule.message
    ? applyTemplate(rule.message, {
        property,
        value: target.value,
        path: path.join('.'),
        error: result.message,
        description: rule.description ?? '',
      })
    : result.message

  const { range, source } = locate(rule, path, document, sources)
  const diagnostic: IDiagnostic = {
    code: rule.name,
    message,
    path,
    severity: rule.severity,
    range,
  }
  if (source !== undefined) diagnostic.source = source
  return diagnostic
}

const hasIntersection = (a: Set<string>, b: Set<string>): boolean => {
  for (const value of a) {
    if (b.has(value)) return true
  }
  return false
}

/**
 * Orders findings by source, then line, then character. Sorting by position
 * alone interleaves findings from different files once a run spans multiple
 * sources; grouping by `source` first keeps each file's findings contiguous.
 */
const bySourceThenPosition = (a: IDiagnostic, b: IDiagnostic): number => {
  const sa = a.source ?? ''
  const sb = b.source ?? ''
  if (sa !== sb) return sa < sb ? -1 : 1
  return a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character
}

/** Creates a {@link Linter} runner bound to a normalized `ruleset`. */
export const createLinter = (ruleset: Ruleset): Linter => ({
  run: async (document, options = {}) => {
    const documentFormats = detectFormats(document.data, ruleset.formats)
    const diagnostics: IDiagnostic[] = []

    // Rules split by which document they run against (resolved vs raw). Each
    // dataset is linted with a single deduped query plan so that identical
    // `given`s evaluate once and all `$..` descents share one tree walk.
    const resolvedAvailable = options.resolved !== undefined
    const rawRules: ResolvedRule[] = []
    const resolvedRules: ResolvedRule[] = []
    for (const rule of ruleset.rulesForSource(document.source)) {
      if (!rule.enabled) continue
      if (rule.formats && !hasIntersection(rule.formats, documentFormats)) continue
      if (rule.resolved && resolvedAvailable) resolvedRules.push(rule)
      else rawRules.push(rule)
    }

    // Raw rules run against the root's unresolved tree, so positions always come
    // straight from the root document; only resolved rules can land on inlined
    // external nodes and need the source set.
    await runPlan(ruleset, rawRules, document.data, document, documentFormats, diagnostics, undefined)
    if (resolvedRules.length > 0) {
      await runPlan(ruleset, resolvedRules, options.resolved, document, documentFormats, diagnostics, options.sources)
    }

    return applyScopedOverrides(ruleset, document.source, diagnostics).sort(bySourceThenPosition)
  },
})
