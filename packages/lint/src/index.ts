import {
  type BoundedCache,
  createBoundedCache,
  createRuleset as createCoreRuleset,
  type IDocumentOptions,
  type LintPlugin,
  type LintResolver,
  lintWithResult,
  type ResolvedExtend,
  type Ruleset,
} from './core'
import type { FunctionRegistry, IDiagnostic, RulesetDefinition } from './core/types'
import { type AppliedFix, createFixPlugin, FIX_PLUGIN_NAME, type FixerRegistry, type FixPluginData } from './fix'
import { builtinFunctions } from './functions'
import { collectCustomFunctions, type IRulesetTrustOptions, resolveRulesetFile } from './ruleset-files'

// Re-export the engine, built-in functions, and fix subsystem as the package's
// public API. `./core` also provides a low-level `createRuleset`, deliberately
// omitted here: the higher-level wrapper defined below (which layers in the
// built-in functions and file/package `extends` resolution) is the local export
// and takes its place. Rendering findings is a consumer concern: `lintDocument`
// returns structured `IDiagnostic[]`, and the caller decides how to display or
// serialize them.
export {
  type AliasDefinition,
  type CompiledPath,
  compileQuery,
  createDocument,
  createLinter,
  type Document,
  detectFormats,
  type ExtendModifier,
  type ExtendResolver,
  type Format,
  globToRegExp,
  type IDocumentOptions,
  type IQueryMatch,
  type IRulesetProblem,
  type IRunOptions,
  type Linter,
  type LintOptions,
  type LintPlugin,
  type LintPluginContext,
  type LintPluginResult,
  type LintResolver,
  type LintResolverResult,
  type LintResult,
  lint,
  lintWithResult,
  matchesGlob,
  type PluginRunResult,
  pointerToPath,
  query,
  queryCompiled,
  queryMany,
  type ResolvedExtend,
  type Ruleset,
  type RulesetOptions,
  resolveSourceOrigin,
  resolveSourceOriginFromMap,
  resolveSourcePath,
  runPlugins,
  validateRuleset,
} from './core'
export {
  type AppliedFix,
  type ApplyFixesOptions,
  applyFixes,
  createFixPlugin,
  type EditOp,
  FIX_PLUGIN_NAME,
  type FixContext,
  type Fixer,
  type FixerRegistry,
  type FixPluginData,
  type FixResult,
  type ParserFormat,
} from './fix'
export {
  alphabetical,
  builtinFunctions,
  type CasingType,
  casing,
  defined,
  enumeration,
  falsy,
  type IAlphabeticalOptions,
  type ICasingOptions,
  type IOrOptions,
  type ISchemaOptions,
  type IUnreferencedReusableObjectOptions,
  type IXorOptions,
  length,
  or,
  pattern,
  schema,
  truthy,
  typedEnum,
  undefinedFn,
  unreferencedReusableObject,
  xor,
} from './functions'
export { detectFormat, parseWithPointers } from './parsers'
export type { IRulesetTrustOptions } from './ruleset-files'

/**
 * Resolves an `extends` reference to a ruleset definition. Supports:
 * - local file paths (relative to `basePath`, or absolute): `.yaml` / `.yml` / `.json` / `.js`,
 * - npm package specifiers (resolved from `basePath`), including subpaths.
 *
 * The engine ships no named built-in rulesets, so every string `extends` target
 * is a file path or an npm package.
 *
 * Note what this does *not* do by default: `basePath` is where resolution starts,
 * not a boundary. An absolute path or a `../`-escaping one is followed, and a
 * `.js` target is `require`d — meaning it runs. Pass `restrictTo` to confine
 * resolution to one directory tree when the ruleset is not fully trusted.
 */
export const resolveNamedRuleset = (
  name: string,
  basePath: string = process.cwd(),
  options: IRulesetTrustOptions = {},
): ResolvedExtend => resolveRulesetFile(name, basePath, options)

const buildRuleset = (definition: RulesetDefinition, basePath?: string, restrictTo?: string): Ruleset => {
  const trust: IRulesetTrustOptions = restrictTo !== undefined ? { restrictTo } : {}
  const resolve = (name: string, from: string): ResolvedExtend => resolveNamedRuleset(name, from, trust)
  // Custom functions referenced by name (YAML/JSON rulesets) are loaded relative
  // to the declaring ruleset's directory and layered over the built-ins.
  let functions: FunctionRegistry = builtinFunctions
  const custom: FunctionRegistry = {}
  collectCustomFunctions(definition, basePath ?? process.cwd(), custom, new Set(), {
    ...trust,
    resolveExtend: resolve,
  })
  if (Object.keys(custom).length > 0) functions = { ...builtinFunctions, ...custom }
  return createCoreRuleset(definition, {
    functions,
    resolve,
    ...(basePath !== undefined ? { basePath } : {}),
  })
}

// Building a ruleset is not cheap: it walks the whole `extends` graph, reads and
// parses every referenced file, `require`s every custom function, and normalizes
// every rule. Linting a thousand files against one ruleset used to pay all of
// that a thousand times (~3.6 ms per document with a 200-rule `extends` file,
// regardless of document size), and `fixDocument` paid it up to 11× per
// document. Worse, re-reading the `extends` files meant editing a ruleset
// mid-run silently changed the results half way through.
//
// The cache is keyed by definition *identity* (a WeakMap, so holding a
// definition alive is the caller's business) and then by base path, since the
// same definition resolves differently from a different directory.
const rulesetsByDefinition = new WeakMap<RulesetDefinition, BoundedCache<string, Ruleset>>()
// The `undefined` definition has no identity to key on, and there are only ever a
// handful of base paths in play, so those share one small bounded cache.
const emptyRulesets = createBoundedCache<string, Ruleset>(16)

/**
 * Builds a runnable {@link Ruleset} from a ruleset definition, layering the
 * built-in functions (plus any custom ones the definition declares via
 * `functions` / `functionsDir`) over the core engine and wiring up `extends`
 * resolution against files and npm packages. With no definition it produces an
 * empty ruleset (no rules run).
 *
 * The result is memoized per `(definition object, basePath, restrictTo)` triple,
 * so linting many documents against the same definition builds it once. Treat a
 * definition you have passed in as frozen: mutating it afterwards will not
 * rebuild the ruleset. Pass a fresh object (or a shallow copy) when you genuinely
 * want a rebuild — for example after a ruleset file on disk has changed.
 */
export const createRuleset = (
  definition?: RulesetDefinition,
  basePath?: string,
  options: IRulesetTrustOptions = {},
): Ruleset => {
  const { restrictTo } = options
  const key = `${restrictTo ?? ''}\0${basePath ?? process.cwd()}`
  if (definition === undefined) {
    const cached = emptyRulesets.get(key)
    if (cached) return cached
    const built = buildRuleset({}, basePath, restrictTo)
    emptyRulesets.set(key, built)
    return built
  }
  let byBasePath = rulesetsByDefinition.get(definition)
  if (!byBasePath) {
    byBasePath = createBoundedCache<string, Ruleset>(16)
    rulesetsByDefinition.set(definition, byBasePath)
  }
  const cached = byBasePath.get(key)
  if (cached) return cached
  const built = buildRuleset(definition, basePath, restrictTo)
  byBasePath.set(key, built)
  return built
}

/**
 * Decides whether a caller handed us a definition to build or a ruleset that is
 * already built. A {@link Ruleset} carries methods; a {@link RulesetDefinition}
 * is JSON-shaped data and never does.
 */
const isBuiltRuleset = (ruleset: RulesetDefinition | Ruleset): ruleset is Ruleset =>
  typeof (ruleset as Ruleset).getFunction === 'function'

/** Options for {@link lintDocument}: the document options plus ruleset controls. */
export type ILintOptions = IDocumentOptions & {
  /**
   * The rules to evaluate: either a definition to build with the built-in
   * functions, or a {@link Ruleset} that is already built. When omitted, no rules
   * run.
   *
   * Pass a built one to use a preset that brings its own functions and format
   * detectors — `createOpenApiRuleset()` from `@amritk/lint/rules/openapi`, say.
   * A definition alone cannot express those, so an OpenAPI ruleset handed over as
   * data would have every rule skipped: its functions are unknown here, and its
   * `formats` gate matches nothing against an empty format registry.
   * `rulesetBasePath` and `restrictTo` only apply while *building*, so they are
   * ignored for a ruleset that already is.
   */
  ruleset?: RulesetDefinition | Ruleset
  /** Directory that the ruleset's string `extends` references resolve relative to. */
  rulesetBasePath?: string
  /**
   * Optional root that every file the ruleset pulls in (`extends` targets,
   * custom functions) must resolve under. Off by default — `rulesetBasePath` is
   * only where resolution starts, not a boundary. See the README's "Trust
   * boundary" section for what this does and does not protect against.
   */
  restrictTo?: string
  /**
   * Produces the resolved (`$ref`-dereferenced) tree for rules with
   * `resolved: true`. The engine ships no resolver; pass one (for example
   * wrapping `@amritk/resolve-refs`) to enable `$ref` dereferencing. When
   * omitted, rules see the raw parsed document.
   */
  resolve?: LintResolver
  /**
   * Plugins run after the rule pass. Use {@link lintDocumentWithResult} (not
   * {@link lintDocument}) to read what they return — e.g. the auto-fix plugin's
   * rewritten `output`.
   */
  plugins?: LintPlugin[]
}

/** The full result of a lint run: findings plus anything the plugins produced. */
export type ILintResult = {
  diagnostics: IDiagnostic[]
  /** A rewritten document, when a plugin (e.g. auto-fix) produced one. */
  output?: string
  /** Per-plugin structured output, keyed by plugin name. */
  pluginData: Record<string, unknown>
}

/**
 * Lints a JSON/YAML `input` end to end: parses with source maps and applies the
 * ruleset. Returns just the findings; use {@link lintDocumentWithResult} for the
 * full result.
 *
 * @example
 * ```ts
 * const ruleset = {
 *   rules: {
 *     'require-name': { given: '$', severity: 'error', then: { field: 'name', function: 'truthy' } },
 *   },
 * }
 * const findings = await lintDocument('version: 1\n', { ruleset, source: 'service.yaml' })
 * // findings[].range is ZERO-based; add 1 to line/character to print file:line:col.
 * // findings[].severity is numeric (0 error, 1 warn, 2 info, 3 hint).
 * ```
 */
export const lintDocument = async (input: string, options: ILintOptions = {}): Promise<IDiagnostic[]> =>
  (await lintDocumentWithResult(input, options)).diagnostics

/**
 * Like {@link lintDocument}, but returns the full {@link ILintResult} — including
 * anything the configured `plugins` produced (e.g. the auto-fix plugin's
 * rewritten `output`).
 */
export const lintDocumentWithResult = async (input: string, options: ILintOptions = {}): Promise<ILintResult> => {
  const { ruleset, rulesetBasePath, restrictTo, ...rest } = options
  return runLint(input, toRuleset(ruleset, rulesetBasePath, restrictTo), rest)
}

/** Builds a definition into a {@link Ruleset}, or passes an already-built one straight through. */
const toRuleset = (
  ruleset: RulesetDefinition | Ruleset | undefined,
  basePath: string | undefined,
  restrictTo: string | undefined,
): Ruleset => {
  if (ruleset !== undefined && isBuiltRuleset(ruleset)) return ruleset
  return createRuleset(ruleset, basePath, { ...(restrictTo !== undefined ? { restrictTo } : {}) })
}

/** The lint options minus the three that only exist to *build* a ruleset. */
type RunOptions = Omit<ILintOptions, 'ruleset' | 'rulesetBasePath' | 'restrictTo'>

/** Runs an already-built ruleset, so a caller that lints repeatedly builds it once. */
const runLint = async (input: string, ruleset: Ruleset, options: RunOptions): Promise<ILintResult> => {
  const { resolve, plugins, ...documentOptions } = options
  return lintWithResult(input, {
    ...documentOptions,
    ruleset,
    ...(resolve ? { resolve } : {}),
    ...(plugins ? { plugins } : {}),
  })
}

/** Options for {@link fixDocument}: the lint options plus auto-fix controls. */
export type IFixOptions = Omit<ILintOptions, 'plugins'> & {
  /** The fixers to apply, keyed by rule code. Defaults to an empty registry (no fixes). */
  fixers?: FixerRegistry
  /** When false, also apply fixers marked `safe: false`. Defaults to true. */
  safeOnly?: boolean
}

/** The result of {@link fixDocument}. */
export type IFixResult = {
  /** The fixed document text (identical to the input when nothing was fixed). */
  output: string
  /** Whether any fix changed the document. */
  fixed: boolean
  /**
   * The findings that were repaired, de-duplicated by rule code and path. Two
   * fixers that undo each other would otherwise report the same finding once per
   * pass, and a `--fix` summary would claim to have fixed eleven problems when
   * there was only ever one.
   */
  applied: AppliedFix[]
  /** Findings that remain after fixing, re-linted against the fixed document. */
  remaining: IDiagnostic[]
  /**
   * Whether the document stopped changing on its own. `false` means the loop hit
   * {@link MAX_FIX_PASSES} while the document was still changing — usually two
   * fixers undoing each other — and `output` is simply wherever it happened to
   * stop. A caller reporting results should say so rather than claim success.
   */
  converged: boolean
  /** How many passes actually changed the document. */
  passes: number
}

/** Identifies a repaired finding for de-duplication: its rule code plus its exact path. */
const appliedKey = (fix: AppliedFix): string =>
  `${fix.code}\0${fix.path.map((segment) => (typeof segment === 'number' ? `[${segment}]` : `.${segment}`)).join('')}`

// One fix pass can unblock the next, so we lint-and-fix to a fixpoint. The cap is
// a safety net against a fixer that oscillates rather than converging — in
// practice a couple of passes is plenty.
const MAX_FIX_PASSES = 10

/**
 * Lints a document and applies the supplied `fixers` repeatedly until the
 * document stops changing (or {@link MAX_FIX_PASSES} is reached), then re-lints
 * so `remaining` reflects the fixed document. A one-call convenience over
 * {@link lintDocumentWithResult} + `createFixPlugin`. With no `fixers` this is a
 * no-op that just returns the findings.
 */
export const fixDocument = async (input: string, options: IFixOptions = {}): Promise<IFixResult> => {
  const { fixers = {}, safeOnly, ruleset: rulesetOption, rulesetBasePath, restrictTo, ...lintOptions } = options
  const plugin = createFixPlugin(fixers, { safeOnly: safeOnly !== false })
  // One ruleset for the whole loop: every pass lints the same document against
  // the same rules, so rebuilding it per pass only bought us the chance of the
  // rules changing underneath us mid-fix.
  const ruleset = toRuleset(rulesetOption, rulesetBasePath, restrictTo)

  let current = input
  let passes = 0
  let converged = false
  const applied: AppliedFix[] = []
  const seen = new Set<string>()
  for (let pass = 0; pass < MAX_FIX_PASSES; pass++) {
    const result = await runLint(current, ruleset, { ...lintOptions, plugins: [plugin] })
    // No rewrite, or a rewrite that matches what we already have, means we have converged.
    if (result.output === undefined || result.output === current) {
      converged = true
      break
    }
    current = result.output
    passes++
    const data = result.pluginData[FIX_PLUGIN_NAME] as FixPluginData | undefined
    if (data) {
      for (const fix of data.applied) {
        const key = appliedKey(fix)
        if (seen.has(key)) continue
        seen.add(key)
        applied.push(fix)
      }
    }
  }

  const remaining = (await runLint(current, ruleset, lintOptions)).diagnostics
  // `fixed` is documented as "whether any fix changed the document", so it has
  // to be measured on the document. `applied.length > 0` is a different
  // question — a multi-op fix whose ops were partly deferred rewrites the text
  // without being reported as applied, which read back as `fixed: false` on an
  // output that had in fact changed.
  return { output: current, fixed: current !== input, remaining, applied, converged, passes }
}
