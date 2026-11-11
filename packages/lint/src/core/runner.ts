import { preloadRuntimeValidators } from '#deps/runtime-validators'

import type { IRange, JsonPath } from '../parsers'
import type { Document } from './document'
import { detectFormats } from './formats'
import { matchesGlob } from './glob'
import { type CompiledPath, compileQuery, type MatchNode, matchPath, query, queryManyNodes } from './jsonpath'
import { bySourceThenPosition } from './order'
import { ownKey } from './own-key'
import { createSourcePathIndex, pointerToPath, resolveSourcePath } from './pointers'
import type { Ruleset } from './ruleset'
import { createRunScope, RUN_SCOPE, type RunScope } from './run-scope'
import { severityFromName } from './severity'
import {
  DiagnosticSeverity,
  type IDiagnostic,
  type IFunctionContext,
  type IFunctionResult,
  type ISourceDocument,
  type ISourceSet,
  type IThen,
  type ResolvedRule,
  type RulesetFunction,
} from './types'

const ZERO_RANGE: IRange = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }

/**
 * A node a `then` runs against. Its path is built by {@link targetPath} on first
 * read: most targets never become findings, and building a path for every match
 * was the single largest cost of a run on a large spec.
 *
 * Each JSONPath match is itself a target, shared by every rule and every `then`
 * on it that has no `field`. Only a `field` allocates more, one per node it
 * narrows to, so a `then` costs no allocation beyond its function's context.
 */
type Target = {
  value: unknown
  node: MatchNode
  /** The match this target narrows with a `field`; `undefined` when the target is the match itself. */
  match: Target | undefined
  /** Segments the `field` adds after the match's path. */
  suffix: JsonPath | undefined
  path: JsonPath | undefined
}

const matchTarget = (node: MatchNode): Target => ({
  value: node.value,
  node,
  match: undefined,
  suffix: undefined,
  path: undefined,
})

const fieldTarget = (match: Target, value: unknown, suffix: JsonPath): Target => ({
  value,
  node: match.node,
  match,
  suffix,
  path: undefined,
})

const targetPath = (target: Target): JsonPath => {
  if (target.path !== undefined) return target.path
  const match = target.match
  target.path = match === undefined ? matchPath(target.node) : [...targetPath(match), ...(target.suffix as JsonPath)]
  return target.path
}

/**
 * Where a context keeps its target for the `path` getter. It is an own,
 * enumerable symbol key: `Object.keys`, `JSON.stringify` and `for...in` skip it,
 * while `Reflect.ownKeys` lists it and a spread copies it. Hiding it with
 * `Object.defineProperty` would put each context on V8's slow path again.
 */
const TARGET = Symbol('target')

/** The context handed to a rule function, carrying the target its `path` getter reads. */
type RunContext = IFunctionContext & { [TARGET]: Target; [RUN_SCOPE]: RunScope }

/**
 * Every rule function's context inherits `path` from here, so the path is only
 * built when a function reads it. The getter lives on a shared prototype rather
 * than on each context: V8 builds an object with its own accessor on a slow
 * path, and on Node that cost more than the paths it saved.
 */
const contextPrototype = {
  get path(): JsonPath {
    return targetPath((this as RunContext)[TARGET])
  },
  /**
   * Assigning `context.path` gives that context an own data property, as the
   * plain property it replaces did. It only changes what the function reads
   * back, never where the finding lands.
   */
  set path(path: JsonPath) {
    Object.defineProperty(this, 'path', { value: path, writable: true, enumerable: true, configurable: true })
  },
}

const isIndexable = (value: unknown): value is Record<string, unknown> | unknown[] =>
  typeof value === 'object' && value !== null

const isThenable = (value: unknown): value is Promise<unknown> =>
  typeof (value as { then?: unknown } | null)?.then === 'function'

/**
 * Narrows a match to the nodes a `then` with a `field` runs against, mirroring
 * Spectral's `getLintTargets`. Both objects and arrays are indexable containers,
 * so `@key` yields keys/indices and a numeric field indexes into an array; a
 * field against a primitive lints the matched value itself; a `$`-prefixed field
 * runs as a sub-query.
 */
const resolveTargets = (match: Target, field: string): Target[] => {
  const value = match.value
  // A field only narrows into a container; against a primitive (or null) the
  // matched value itself is the target.
  if (!isIndexable(value)) return [match]
  if (field === '@key') {
    // Object.keys over an array yields its indices (as strings); normalize those
    // back to numbers for the path so lookups stay consistent.
    return Object.keys(value).map((key) => fieldTarget(match, key, [Array.isArray(value) ? Number(key) : key]))
  }
  if (field.startsWith('$')) {
    return query(value, field).map((sub) => fieldTarget(match, sub.value, sub.path))
  }
  // A plain property name, or a numeric index into an array. `Object.hasOwn`, not
  // a bare index: `field` is ruleset input, so `field: 'constructor'` otherwise
  // handed the function every object inherits to the rule function — `defined`
  // and `truthy` both passed on a key the document does not have.
  const key = Array.isArray(value) && /^\d+$/.test(field) ? Number(field) : field
  const own = Object.hasOwn(value, key) ? (value as Record<string | number, unknown>)[key] : undefined
  return [fieldTarget(match, own, [key])]
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
    // `Object.hasOwn`, not `in`: the template comes from the ruleset, so
    // `{{toString}}` otherwise resolved to `Object.prototype.toString` and
    // rendered the literal text "undefined" where an unknown placeholder should
    // render as nothing.
    const key = raw.trim() as keyof typeof ctx
    return Object.hasOwn(ctx, key) ? stringify(ctx[key]) : ''
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

/**
 * Resolves where a finding's `path` maps to in the source: the path in the
 * originating document, its range, and that document's `source`.
 *
 * A rule with `resolved: true` matched against the dereferenced tree, so its
 * path names a position that may not exist in what the author wrote — a
 * `$ref` site rather than the declaration behind it. The `sourcePath` returned
 * here is the authored one, and it is what the finding carries: a path and a
 * range that describe two different trees is a diagnostic nobody can act on,
 * and a fixer resolving that path against the raw document would find nothing.
 */
const locate = (
  rule: ResolvedRule,
  path: JsonPath,
  document: Document,
  sources: ISourceSet | undefined,
): { sourcePath: JsonPath; range: IRange; source: string | undefined } => {
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
  return { sourcePath, range: location?.range ?? ZERO_RANGE, source: originDocument.source }
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
 * shared tree walk inside `queryManyNodes`.
 *
 * A rule that references an unknown named function is reported once (not per
 * node) and skipped; a rule function that throws (or rejects) becomes an
 * error-severity diagnostic on that node so one bad rule cannot abort the run.
 *
 * `resolved` says `data` is a tree a resolver produced from `$ref`s, where one
 * object stands wherever a reference pointed at it. Its walk then enters each
 * object once per walk state instead of once per route (see `SharedWalkOptions`):
 * {@link locate} translates every route back to the same authored node, so a
 * revisit could only add a finding at the same location: one `withoutDuplicates`
 * drops, unless its message spells the route out (`{{path}}`) or the caller reads
 * `Linter.run`'s findings before deduplication. Data the caller
 * built may share objects for other reasons, where routes are distinct authored
 * paths, so it is never passed here as `resolved`.
 *
 * `scope` is the run's {@link RunScope}, handed to every function context.
 */
const runPlan = async (
  ruleset: Ruleset,
  rules: ResolvedRule[],
  data: unknown,
  document: Document,
  formats: Set<string>,
  out: IDiagnostic[],
  sources: ISourceSet | undefined,
  resolved: boolean,
  scope: RunScope,
): Promise<void> => {
  if (rules.length === 0) return
  const order: string[] = []
  const groups = new Map<string, { compiled: CompiledPath; schemaAware: boolean; rules: ResolvedRule[] }>()
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
    const schemaAware = rule.descent === 'schema'
    for (const given of ruleset.expandGiven(rule.given, formats)) {
      // The same `given` read schema-aware is a different query.
      const key = schemaAware ? `${given}\0schema` : given
      let group = groups.get(key)
      if (!group) {
        group = { compiled: compileQuery(given), schemaAware, rules: [] }
        groups.set(key, group)
        order.push(key)
      }
      // Guard against a rule listing the same `given` twice.
      if (group.rules[group.rules.length - 1] !== rule) group.rules.push(rule)
    }
  }

  const planned = order.map((key) => groups.get(key) as { compiled: CompiledPath; schemaAware: boolean })
  const matchesPerGiven = queryManyNodes(
    data,
    planned.map((group) => group.compiled),
    planned.map((group) => (group.schemaAware ? { schemaAware: true } : undefined)),
    resolved
      ? {
          skipRevisits: true,
          ...(sources === undefined && routesMayDiverge(document.data, data)
            ? { sameNode: sameAuthoredNode(document.data) }
            : {}),
        }
      : {},
  )
  const state: RunState = { ruleset, document, out, sources, scope }
  for (let i = 0; i < order.length; i++) {
    const group = groups.get(order[i] as string) as { rules: ResolvedRule[] }
    const nodes = matchesPerGiven[i] as MatchNode[]
    for (const node of nodes) {
      // Shared by every rule on this node, so its path is built once at most.
      const match = matchTarget(node)
      for (const rule of group.rules) {
        for (const then of rule.then) {
          const pending = runThen(state, rule, then, match)
          if (pending !== undefined) await pending
        }
      }
    }
  }
}

/**
 * Siblings of a `$ref` that only annotate it. A resolver lays them over the target
 * at the ref site, so a route past them reads the site's own value, never a node
 * shared with another site.
 */
const ANNOTATION_KEYS = new Set([
  '$ref',
  '$comment',
  'title',
  'summary',
  'description',
  'deprecated',
  'readOnly',
  'writeOnly',
  'example',
  'examples',
  'default',
  'nullable',
])

/**
 * Whether two routes to one shared object of `resolved` could trace back to
 * different authored paths. {@link resolveSourcePath} follows internal `$ref`s and
 * reads a ref's own siblings at the ref site, so routes only part ways at a ref
 * site the resolver changed that either names another document (followed by no
 * internal step) or carries siblings beyond annotations (where a resolver merges
 * the target in, as into the ref's own `allOf`). A ref left as written in the
 * resolved tree inlined nothing. A site the resolved tree no longer has at its
 * path counts as changed, since nothing says otherwise. So does an object the
 * parsed document itself reaches twice — data a caller built, which a resolver
 * may hand back as is, shares it at authored paths of its own. One pass over the
 * parsed document, iterative because its depth is the author's to choose; paths
 * are spelled out only for ref sites.
 */
const routesMayDiverge = (data: unknown, resolved: unknown): boolean => {
  type Entry = { value: unknown; parent: Entry | undefined; key: string | number }
  const pathOf = (entry: Entry): JsonPath => {
    const path: JsonPath = []
    for (let at: Entry | undefined = entry; at?.parent !== undefined; at = at.parent) path.push(at.key)
    return path.reverse()
  }
  const stack: Entry[] = [{ value: data, parent: undefined, key: '' }]
  const seen = new WeakSet<object>()
  while (stack.length > 0) {
    const entry = stack.pop() as Entry
    const value = entry.value
    if (value === null || typeof value !== 'object') continue
    if (seen.has(value)) return true
    seen.add(value)
    const ref = (value as { $ref?: unknown }).$ref
    if (
      typeof ref === 'string' &&
      (!ref.startsWith('#') || Object.keys(value).some((key) => !ANNOTATION_KEYS.has(key)))
    ) {
      const there = pathOf(entry).reduce<unknown>(
        (node, segment) =>
          node !== null && typeof node === 'object' && Object.hasOwn(node, segment)
            ? (node as Record<string | number, unknown>)[segment]
            : undefined,
        resolved,
      )
      if (there === null || typeof there !== 'object' || (there as { $ref?: unknown }).$ref !== ref) return true
    }
    const keys: (string | number)[] = Array.isArray(value) ? value.map((_, index) => index) : Object.keys(value)
    for (const key of keys) stack.push({ value: (value as Record<string | number, unknown>)[key], parent: entry, key })
  }
  return false
}

/**
 * A `sameNode` for a resolved tree that came without a source set. {@link locate}
 * then traces a route with {@link resolveSourcePath}, which follows internal
 * `$ref`s only and reads a ref's own siblings at the ref site: a node a
 * cross-document ref inlined is reported at each ref site, and so is a target a
 * resolver merged into a ref's `allOf`. Two routes to one object are the same
 * finding only when they trace back to the same authored path, which this asks
 * of an index built once per walk. With a source set every route is traced to
 * the node's own document, so no check is needed.
 */
const sameAuthoredNode = (data: unknown): ((first: MatchNode, again: MatchNode) => boolean) => {
  const sourcePathOf = createSourcePathIndex<MatchNode>(data)
  return (first, again) => {
    const a = sourcePathOf(first)
    const b = sourcePathOf(again)
    return a.length === b.length && a.every((segment, index) => segment === b[index])
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
      // `ownKey`, not a bare index: rule codes come from the ruleset, so a rule
      // named `toString` matched `Function.prototype.toString` and the override
      // silently did nothing. (`severityFromName` guards the severity side.)
      const entry = ownKey(rules, String(diagnostic.code))
      if (entry === undefined) continue
      if (entry === false || entry === 'off') {
        dropped = true
        break
      }
      if (typeof entry === 'number') diagnostic.severity = entry
      else if (typeof entry === 'string') {
        const mapped = severityFromName(entry)
        // `'off'` was already handled above; anything else unknown is left alone.
        if (typeof mapped === 'number') diagnostic.severity = mapped
      }
    }
    if (!dropped) result.push(diagnostic)
  }
  return result
}

/** What every `then` in one plan reads and writes: the run's inputs and its findings so far. */
type RunState = {
  ruleset: Ruleset
  document: Document
  out: IDiagnostic[]
  sources: ISourceSet | undefined
  scope: RunScope
}

/**
 * Runs one `then` against a match. Returns `undefined` when every function call
 * finished synchronously, and a Promise only once one returned a thenable (a
 * Spectral-style async function): awaiting every `then` cost each match a
 * microtask, which a rule-dense run pays tens of thousands of times for nothing.
 * Targets still run one after another, so findings land in the same order.
 */
const runThen = (state: RunState, rule: ResolvedRule, then: IThen, match: Target): Promise<void> | undefined => {
  // A malformed rule (e.g. a `then` with no `function`, which `validateRuleset`
  // warns about) is skipped rather than crashing the whole run.
  if (!then || (typeof then.function !== 'function' && typeof then.function !== 'string')) return undefined
  const fn = typeof then.function === 'function' ? then.function : state.ruleset.getFunction(then.function)
  // Unknown named functions are handled once per rule in `runPlan`; nothing to do.
  if (!fn) return undefined
  if (then.field === undefined) return runTarget(state, rule, then, fn, match)

  const targets = resolveTargets(match, then.field)
  for (let i = 0; i < targets.length; i++) {
    const pending = runTarget(state, rule, then, fn, targets[i] as Target)
    if (pending !== undefined) return finishTargets(pending, state, rule, then, fn, targets, i + 1)
  }
  return undefined
}

/** Carries on with a `then`'s remaining targets once one of them went async. */
const finishTargets = async (
  pending: Promise<void>,
  state: RunState,
  rule: ResolvedRule,
  then: IThen,
  fn: RulesetFunction,
  targets: Target[],
  from: number,
): Promise<void> => {
  await pending
  for (let i = from; i < targets.length; i++) {
    const next = runTarget(state, rule, then, fn, targets[i] as Target)
    if (next !== undefined) await next
  }
}

/**
 * Calls a rule function on one target and records what it reports. A function
 * that throws (or rejects) becomes an error diagnostic on that node, so one bad
 * rule cannot abort the run; an error while building a finding still does.
 */
const runTarget = (
  state: RunState,
  rule: ResolvedRule,
  then: IThen,
  fn: RulesetFunction,
  target: Target,
): Promise<void> | undefined => {
  let raw: unknown
  try {
    const context: RunContext = Object.create(contextPrototype)
    context.document = state.document
    context.value = target.value
    context.rule = rule
    context.functionOptions = then.functionOptions
    context[TARGET] = target
    context[RUN_SCOPE] = state.scope
    // The declared signature is synchronous, but a function reference may in
    // fact return a Promise, so treat the raw result as unknown.
    raw = fn(target.value, then.functionOptions ?? {}, context)
  } catch (error) {
    reportThrow(state, rule, target, error)
    return undefined
  }
  if (!isThenable(raw)) {
    collect(state, rule, target, raw as IFunctionResult[] | undefined)
    return undefined
  }
  // `Promise.resolve` adopts the thenable the way `await` would, so a `then`
  // that throws is a rejection here too.
  return Promise.resolve(raw).then(
    (results) => collect(state, rule, target, results as IFunctionResult[] | undefined),
    (error: unknown) => reportThrow(state, rule, target, error),
  )
}

const collect = (state: RunState, rule: ResolvedRule, target: Target, results: IFunctionResult[] | undefined): void => {
  if (!results) return
  for (const result of results) {
    state.out.push(toDiagnostic(rule, result, target, state.document, state.sources))
  }
}

/** Records a function that threw or rejected as an error diagnostic on its node, so the run carries on. */
const reportThrow = (state: RunState, rule: ResolvedRule, target: Target, error: unknown): void => {
  const { sourcePath, range, source } = locate(rule, targetPath(target), state.document, state.sources)
  const reason = error instanceof Error ? error.message : String(error)
  state.out.push(errorDiagnostic(rule, sourcePath, `Rule "${rule.name}" threw: ${reason}`, range, source))
}

const toDiagnostic = (
  rule: ResolvedRule,
  result: IFunctionResult,
  target: Target,
  document: Document,
  sources: ISourceSet | undefined,
): IDiagnostic => {
  const path = result.path ?? targetPath(target)
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

  const { sourcePath, range, source } = locate(rule, path, document, sources)
  const diagnostic: IDiagnostic = {
    code: rule.name,
    message,
    path: sourcePath,
    severity: rule.severity,
    range,
  }
  if (source !== undefined) diagnostic.source = source
  return diagnostic
}

/**
 * Whether any of `rules` runs the `schema` function. A run loads its validator
 * before the first rule when one does, from the async step `run` already has:
 * the function itself is synchronous, so loading it there would take a
 * `require()` (see `#deps/runtime-validators`).
 */
const runsSchema = (ruleset: Ruleset, rules: ResolvedRule[]): boolean => {
  const schema = ruleset.getFunction('schema')
  return rules.some((rule) =>
    rule.then.some((then) => then?.function === 'schema' || (schema !== undefined && then?.function === schema)),
  )
}

const hasIntersection = (a: Set<string>, b: Set<string>): boolean => {
  for (const value of a) {
    if (b.has(value)) return true
  }
  return false
}

/** Creates a {@link Linter} runner bound to a normalized `ruleset`. */
export const createLinter = (ruleset: Ruleset): Linter => ({
  run: async (document, options = {}) => {
    const documentFormats = detectFormats(document.data, ruleset.formats)
    const diagnostics: IDiagnostic[] = []
    // Fresh for every run, so nothing a function memoized outlives the data it read.
    const scope = createRunScope()

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

    if (runsSchema(ruleset, rawRules) || runsSchema(ruleset, resolvedRules)) await preloadRuntimeValidators()

    // Raw rules run against the root's unresolved tree, so positions always come
    // straight from the root document; only resolved rules can land on inlined
    // external nodes and need the source set.
    await runPlan(ruleset, rawRules, document.data, document, documentFormats, diagnostics, undefined, false, scope)
    if (resolvedRules.length > 0) {
      await runPlan(
        ruleset,
        resolvedRules,
        options.resolved,
        document,
        documentFormats,
        diagnostics,
        options.sources,
        // With no resolver the "resolved" tree is the parsed data itself, whose
        // sharing (if any) is the caller's, not `$ref`'s.
        options.resolved !== document.data,
        scope,
      )
    }

    return applyScopedOverrides(ruleset, document.source, diagnostics).sort(bySourceThenPosition)
  },
})
