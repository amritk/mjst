import type { DiagnosticSeverity, ILocation, IRange, JsonPath } from '../parsers'
import type { Document } from './document'

export type { ILocation, IPosition, IRange, JsonPath } from '../parsers'
export { DiagnosticSeverity } from '../parsers'

/** The string severities a ruleset author can write, plus `off` to disable a rule. */
export type HumanReadableSeverity = 'error' | 'warn' | 'info' | 'hint' | 'off'

/** A single finding produced by a function. */
export type IFunctionResult = {
  message: string
  path?: JsonPath
}

/** Context passed to every function invocation. */
export type IFunctionContext = {
  document: Document
  /** The path of the value the function was invoked on. */
  path: JsonPath
  /** The original `given` value the rule matched. */
  value?: unknown
  /** Rule metadata. */
  rule: ResolvedRule
  /** Function options as authored in the ruleset. */
  functionOptions?: unknown
}

/**
 * A rule function: given the matched `input`, its authored `options`, and the
 * run `context`, returns any findings (or `undefined`/`[]` for none).
 *
 * The declared return type is synchronous because the built-in functions are,
 * but the runner also awaits a thenable result at run time, so a Spectral-style
 * async function works when passed as a reference (see {@link AsyncRulesetFunction}).
 */
export type RulesetFunction<I = unknown, O = unknown> = (
  input: I,
  options: O,
  context: IFunctionContext,
) => IFunctionResult[] | undefined

/**
 * A rule function that resolves its findings asynchronously. The runner awaits a
 * thenable result, so such a function may be passed by reference in a JS ruleset;
 * cast it to {@link RulesetFunction} at the `then.function` site.
 */
export type AsyncRulesetFunction<I = unknown, O = unknown> = (
  input: I,
  options: O,
  context: IFunctionContext,
) => Promise<IFunctionResult[] | undefined>

/** Functions a ruleset can invoke by name in `then.function`, keyed by that name. */
export type FunctionRegistry = Record<string, RulesetFunction>

/** One action a rule takes on each match: a function plus how to target/configure it. */
export type IThen = {
  /**
   * Narrows the target before running the function. `$` = current value,
   * `@key` = each property key, or a property name.
   */
  field?: string
  /**
   * A built-in/registered function name (YAML/JSON rulesets) or a direct function
   * reference (JS rulesets that import their own functions).
   */
  function: string | RulesetFunction
  functionOptions?: Record<string, unknown>
}

/** A rule as authored in a ruleset, before normalization. */
export type IRuleDefinition = {
  description?: string
  message?: string
  severity?: DiagnosticSeverity | HumanReadableSeverity
  given: string | string[]
  then: IThen | IThen[]
  formats?: string[]
  recommended?: boolean
  /** When false, the rule runs against the unresolved document. Default true. */
  resolved?: boolean
  documentationUrl?: string
}

/** Shorthand a rule may take in `rules`: a definition, a boolean, or a severity. */
export type RuleEntry = IRuleDefinition | boolean | HumanReadableSeverity

/**
 * A per-file override: `files` globs select the documents it applies to, and
 * `rules` re-toggles or re-severities rules for them. Spectral's `extends` and
 * `formats` on an override are intentionally omitted here — they were never
 * applied by the engine, so carrying them in the type only advertised support
 * that did not exist. Re-add them alongside a real implementation if needed.
 */
export type IRulesetOverride = {
  files: string[]
  rules?: Record<string, RuleEntry>
}

/**
 * The shape of a ruleset's `extends`: a single target or a list, where each
 * entry may be paired with a modifier (`all` / `recommended` / `off`) to control
 * which of the extended rules turn on.
 */
export type RulesetExtends =
  | string
  | RulesetDefinition
  | (string | RulesetDefinition | [string | RulesetDefinition, 'all' | 'recommended' | 'off'])[]

/** A ruleset as authored: rules, `extends`, custom functions, overrides, and aliases. */
export type RulesetDefinition = {
  extends?: RulesetExtends
  rules?: Record<string, RuleEntry>
  /**
   * Names of custom functions a YAML/JSON ruleset references by string in
   * `then.function`. Loaded from `functionsDir` (default `functions`, relative to
   * the ruleset file) by the CLI/rulesets layer. JS rulesets can instead pass a
   * direct function reference and skip this.
   */
  functions?: string[]
  /** Directory (relative to the ruleset file) that `functions` are loaded from. Defaults to `functions`. */
  functionsDir?: string
  overrides?: IRulesetOverride[]
  aliases?: Record<string, string[] | { description?: string; targets: { formats: string[]; given: string[] }[] }>
  formats?: string[]
  documentationUrl?: string
  parserOptions?: {
    duplicateKeys?: DiagnosticSeverity | HumanReadableSeverity
    incompatibleValues?: DiagnosticSeverity | HumanReadableSeverity
  }
}

/** A fully normalized rule ready to execute. */
export type ResolvedRule = {
  name: string
  description?: string | undefined
  message?: string | undefined
  severity: DiagnosticSeverity
  enabled: boolean
  given: string[]
  then: IThen[]
  formats?: Set<string> | undefined
  recommended: boolean
  resolved: boolean
  documentationUrl?: string | undefined
}

/** A single finding emitted by the runner, mapped back to a source range. */
export type IDiagnostic = {
  code: string | number
  message: string
  path: JsonPath
  severity: DiagnosticSeverity
  source?: string
  range: IRange
}

/** A single parsed source document with its own line:column source map. */
export type ISourceDocument = {
  readonly data: unknown
  /** Display path used as a finding's `source` (e.g. a path relative to cwd, or a URL). */
  readonly source?: string | undefined
  getLocationForJsonPath(path: JsonPath, closest?: boolean): ILocation | undefined
}

/** Where a resolved-tree node originated: which source document, and the path within it. */
export type ISourceOrigin = {
  /** Absolute location (file path or URL) of the originating document. */
  location: string
  /** The path within that document. */
  path: JsonPath
}

/**
 * Source documents keyed by absolute location, with a known root. This is the
 * input to the cross-document walk that re-derives a node's origin from the
 * *unresolved* documents (see `resolveSourceOrigin`).
 */
export type IDocumentRegistry = {
  /** Absolute location of the root document (the walk's starting point). */
  readonly rootLocation: string
  get(location: string): ISourceDocument | undefined
}

/**
 * Per-node origin metadata produced by the resolver (`@amritk/resolve-refs`'
 * `trackOrigins`): given an inlined object/array, where it came from. Lets us
 * find a node's origin with a single downward walk of the resolved tree instead
 * of re-deriving the resolver's `$ref` traversal.
 */
export type IOriginMap = {
  get(node: object): { location: string; pointer: JsonPath } | undefined
}

/**
 * The runner-facing view of the source documents behind a resolved tree. Lets
 * findings on nodes inlined from external files map back to the correct file's
 * line:column. `get` resolves a location to its document; `origin` maps a
 * resolved-tree path to the document and in-file path it came from (backed by
 * either the resolver's origin map or the cross-document walk). A `Document`
 * satisfies `ISourceDocument`.
 */
export type ISourceSet = {
  get(location: string): ISourceDocument | undefined
  origin(path: JsonPath): ISourceOrigin
}
