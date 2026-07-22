import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, resolve as resolvePath } from 'node:path'

import {
  createRuleset as createCoreRuleset,
  type FunctionRegistry,
  type IDiagnostic,
  type IDocumentOptions,
  type LintPlugin,
  type LintResolver,
  lintWithResult,
  type ResolvedExtend,
  type Ruleset,
  type RulesetDefinition,
  type RulesetFunction,
} from './core'
import { type AppliedFix, createFixPlugin, FIX_PLUGIN_NAME, type FixerRegistry, type FixPluginData } from './fix'
import { builtinFunctions } from './functions'
import { parseWithPointers } from './parsers'

// Re-export the engine, built-in functions, and fix subsystem as the package's
// public API. `./core` also provides a low-level `createRuleset`, deliberately
// omitted here: the higher-level wrapper defined below (which layers in the
// built-in functions and file/package `extends` resolution) is the local export
// and takes its place. Rendering findings is a consumer concern: `lintDocument`
// returns structured `IDiagnostic[]`, and the caller decides how to display or
// serialize them.
export {
  type AliasDefinition,
  type AsyncRulesetFunction,
  type CompiledPath,
  compileQuery,
  createDocument,
  createLinter,
  detectFormats,
  DiagnosticSeverity,
  type Document,
  type ExtendModifier,
  type ExtendResolver,
  type Format,
  type FunctionRegistry,
  globToRegExp,
  type HumanReadableSeverity,
  type IDiagnostic,
  type IDocumentOptions,
  type IDocumentRegistry,
  type IFunctionContext,
  type IFunctionResult,
  type ILocation,
  type IOriginMap,
  type IPosition,
  type IQueryMatch,
  type IRange,
  type IRuleDefinition,
  type IRulesetOverride,
  type IRulesetProblem,
  type IRunOptions,
  type ISourceDocument,
  type ISourceOrigin,
  type ISourceSet,
  type IThen,
  type JsonPath,
  lint,
  type LintOptions,
  type LintPlugin,
  type LintPluginContext,
  type LintPluginResult,
  type LintResolver,
  type LintResolverResult,
  type LintResult,
  type Linter,
  lintWithResult,
  matchesGlob,
  type PluginRunResult,
  pointerToPath,
  query,
  queryCompiled,
  queryMany,
  type ResolvedExtend,
  type ResolvedRule,
  resolveSourceOrigin,
  resolveSourceOriginFromMap,
  resolveSourcePath,
  type RuleEntry,
  type Ruleset,
  type RulesetDefinition,
  type RulesetExtends,
  type RulesetFunction,
  type RulesetOptions,
  runPlugins,
  validateRuleset,
} from './core'
export {
  type AppliedFix,
  applyFixes,
  type ApplyFixesOptions,
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
  casing,
  type CasingType,
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

const require = createRequire(import.meta.url)

/** Loads a ruleset definition from a file path by extension (YAML/JSON parsed, JS/CJS/MJS required). */
const loadRulesetFile = (file: string): RulesetDefinition => {
  if (/\.(ya?ml|json)$/i.test(file)) {
    return parseWithPointers<RulesetDefinition>(readFileSync(file, 'utf8')).data
  }
  const module = require(file) as { default?: RulesetDefinition } & RulesetDefinition
  return (module.default ?? module) as RulesetDefinition
}

/**
 * Resolves an `extends` reference to a ruleset definition. Supports:
 * - local file paths (relative to `basePath`, or absolute): `.yaml` / `.yml` / `.json` / `.js`,
 * - npm package specifiers (resolved from `basePath`), including subpaths.
 *
 * The engine ships no named built-in rulesets, so every string `extends` target
 * is a file path or an npm package.
 */
export const resolveNamedRuleset = (name: string, basePath: string = process.cwd()): ResolvedExtend => {
  if (name.startsWith('.') || isAbsolute(name)) {
    const file = resolvePath(basePath, name)
    return { definition: loadRulesetFile(file), basePath: dirname(file) }
  }
  let file: string
  try {
    file = require.resolve(name, { paths: [basePath] })
  } catch {
    throw new Error(`Cannot resolve extended ruleset "${name}" from ${basePath}`)
  }
  return { definition: loadRulesetFile(file), basePath: dirname(file) }
}

/** Loads a single custom function module (`<dir>/<name>.{js,cjs,mjs}` or a bare path). */
const loadFunctionByName = (basePath: string, dir: string, name: string): RulesetFunction => {
  const baseFile = resolvePath(basePath, dir, name)
  for (const candidate of [baseFile, `${baseFile}.js`, `${baseFile}.cjs`, `${baseFile}.mjs`]) {
    try {
      const resolvedFile = require.resolve(candidate)
      const module = require(resolvedFile) as { default?: RulesetFunction } & RulesetFunction
      const fn = module.default ?? module
      if (typeof fn !== 'function') throw new Error(`"${name}" did not export a function`)
      return fn as RulesetFunction
    } catch (error) {
      if ((error as { code?: string }).code !== 'MODULE_NOT_FOUND') throw error
    }
  }
  throw new Error(`Cannot resolve custom function "${name}" from ${resolvePath(basePath, dir)}`)
}

/**
 * Walks a ruleset definition (and its string `extends`) collecting custom
 * functions declared via `functions` / `functionsDir`, each loaded relative to
 * the directory of the ruleset that declared it. YAML/JSON rulesets reference
 * functions by name; JS rulesets can instead pass direct references in `then`.
 */
const collectCustomFunctions = (
  definition: RulesetDefinition,
  basePath: string,
  into: FunctionRegistry,
  // Keyed by (basePath, reference) for string extends and by object identity for
  // inline ones. `loadRulesetFile` returns a fresh object per read, so object
  // identity alone would never dedupe a file cycle — we key on the resolved edge.
  seen: Set<unknown>,
): void => {
  if (seen.has(definition)) return
  seen.add(definition)
  if (definition.extends) {
    const entries = Array.isArray(definition.extends) ? definition.extends : [definition.extends]
    for (const entry of entries) {
      const target = Array.isArray(entry) ? entry[0] : entry
      if (typeof target === 'string') {
        const key = `${basePath}\0${target}`
        if (seen.has(key)) continue
        seen.add(key)
        const resolved = resolveNamedRuleset(target, basePath)
        collectCustomFunctions(resolved.definition, resolved.basePath, into, seen)
      } else {
        collectCustomFunctions(target, basePath, into, seen)
      }
    }
  }
  if (Array.isArray(definition.functions)) {
    const dir = definition.functionsDir ?? 'functions'
    for (const name of definition.functions) into[name] = loadFunctionByName(basePath, dir, name)
  }
}

/**
 * Builds a runnable {@link Ruleset} from a ruleset definition, layering the
 * built-in functions (plus any custom ones the definition declares via
 * `functions` / `functionsDir`) over the core engine and wiring up `extends`
 * resolution against files and npm packages. With no definition it produces an
 * empty ruleset (no rules run).
 */
export const createRuleset = (definition?: RulesetDefinition, basePath?: string): Ruleset => {
  const resolved: RulesetDefinition = definition ?? {}
  // Custom functions referenced by name (YAML/JSON rulesets) are loaded relative
  // to the declaring ruleset's directory and layered over the built-ins.
  let functions: FunctionRegistry = builtinFunctions
  const custom: FunctionRegistry = {}
  collectCustomFunctions(resolved, basePath ?? process.cwd(), custom, new Set())
  if (Object.keys(custom).length > 0) functions = { ...builtinFunctions, ...custom }
  return createCoreRuleset(resolved, {
    functions,
    resolve: resolveNamedRuleset,
    ...(basePath !== undefined ? { basePath } : {}),
  })
}

/** Options for {@link lintDocument}: the document options plus ruleset controls. */
export type ILintOptions = IDocumentOptions & {
  /** The ruleset definition to evaluate. When omitted, no rules run. */
  ruleset?: RulesetDefinition
  /** Directory that the ruleset's string `extends` references resolve relative to. */
  rulesetBasePath?: string
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
 */
export const lintDocument = async (input: string, options: ILintOptions = {}): Promise<IDiagnostic[]> =>
  (await lintDocumentWithResult(input, options)).diagnostics

/**
 * Like {@link lintDocument}, but returns the full {@link ILintResult} — including
 * anything the configured `plugins` produced (e.g. the auto-fix plugin's
 * rewritten `output`).
 */
export const lintDocumentWithResult = async (input: string, options: ILintOptions = {}): Promise<ILintResult> => {
  const { ruleset: rulesetDefinition, rulesetBasePath, resolve, plugins, ...documentOptions } = options
  const ruleset = createRuleset(rulesetDefinition, rulesetBasePath)
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
  /** The findings that were repaired, across every fix pass. */
  applied: AppliedFix[]
  /** Findings that remain after fixing, re-linted against the fixed document. */
  remaining: IDiagnostic[]
}

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
  const { fixers = {}, safeOnly, ...lintOptions } = options
  const plugin = createFixPlugin(fixers, { safeOnly: safeOnly !== false })

  let current = input
  const applied: AppliedFix[] = []
  for (let pass = 0; pass < MAX_FIX_PASSES; pass++) {
    const result = await lintDocumentWithResult(current, { ...lintOptions, plugins: [plugin] })
    // No rewrite, or a rewrite that matches what we already have, means we have converged.
    if (result.output === undefined || result.output === current) break
    current = result.output
    const data = result.pluginData[FIX_PLUGIN_NAME] as FixPluginData | undefined
    if (data) applied.push(...data.applied)
  }

  const remaining = await lintDocument(current, lintOptions)
  return { output: current, fixed: applied.length > 0, remaining, applied }
}
