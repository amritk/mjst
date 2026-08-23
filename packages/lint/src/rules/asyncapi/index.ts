import { createRuleset as createCoreRuleset, type ResolvedExtend, type Ruleset } from '../../core'
import type { FunctionRegistry, RulesetDefinition } from '../../core/types'
import { builtinFunctions } from '../../functions'
import { collectCustomFunctions, type IRulesetTrustOptions, resolveRulesetFile } from '../../ruleset-files'
import { asyncapi } from './asyncapi'
import { aasFormats } from './formats'
import { aasFunctions } from './functions/index'

export type { IRulesetTrustOptions } from '../../ruleset-files'
export { asyncapi } from './asyncapi'
export {
  aas2,
  aas2_0,
  aas2_1,
  aas2_2,
  aas2_3,
  aas2_4,
  aas2_5,
  aas2_6,
  aas3,
  aas3_0,
  aasFormats,
} from './formats'
export { aasFunctions } from './functions/index'
export {
  ASYNCAPI_VERSIONS,
  type AsyncApiVersion,
  asyncApiSchemaVersion,
  LATEST_ASYNCAPI_VERSION,
  loadAsyncApiSchema,
} from './schemas'

/** The built-in `@amritk/lint` functions plus the AsyncAPI-specific ones, keyed by name. */
export const allFunctions: FunctionRegistry = { ...builtinFunctions, ...aasFunctions }

/** The names that resolve to the built-in AsyncAPI ruleset (incl. the legacy Spectral alias). */
const ASYNCAPI_RULESET_NAMES = new Set(['asyncapi', 'loupe:asyncapi', 'spectral:asyncapi'])

/**
 * Resolves an `extends` reference to a ruleset definition. Extends the generic
 * file/package resolution with the AsyncAPI preset names:
 * - `asyncapi` / `loupe:asyncapi` / `spectral:asyncapi` → the built-in {@link asyncapi} ruleset,
 * - local file paths (relative to `basePath`, or absolute): `.yaml` / `.yml` / `.json` / `.js`,
 * - npm package specifiers (resolved from `basePath`), including subpaths.
 *
 * As with the core `resolveNamedRuleset`, `basePath` is where resolution starts,
 * not a boundary: an absolute or `../`-escaping path is followed and a `.js`
 * target is `require`d. Pass `restrictTo` to confine resolution to one directory
 * tree when the ruleset is not fully trusted.
 */
export const resolveAsyncApiRuleset = (
  name: string,
  basePath: string = process.cwd(),
  options: IRulesetTrustOptions = {},
): ResolvedExtend => {
  if (ASYNCAPI_RULESET_NAMES.has(name)) return { definition: asyncapi, basePath }
  return resolveRulesetFile(name, basePath, options)
}

/**
 * Builds a runnable {@link Ruleset} for AsyncAPI, layering the built-in and
 * AsyncAPI functions (plus any custom ones the definition declares), the
 * AsyncAPI `formats`, and `extends` resolution that understands the `asyncapi` /
 * `loupe:asyncapi` / `spectral:asyncapi` names. With no definition it defaults to
 * `extends: [asyncapi]` (recommended rules only). Feed the result to
 * `@amritk/lint`'s core `lintWithResult` (with a `$ref` resolver for
 * `resolved: true` rules).
 */
export const createAsyncApiRuleset = (
  definition?: RulesetDefinition,
  basePath?: string,
  options: IRulesetTrustOptions = {},
): Ruleset => {
  // With no explicit ruleset, behave like `extends: [asyncapi]` so only
  // `recommended` rules run by default. A user-supplied ruleset is used as-is
  // (its own rules run regardless of `recommended`).
  const definitionOrDefault: RulesetDefinition = definition ?? { extends: [asyncapi] }
  const trust: IRulesetTrustOptions = options.restrictTo !== undefined ? { restrictTo: options.restrictTo } : {}
  const resolve = (name: string, from: string): ResolvedExtend => resolveAsyncApiRuleset(name, from, trust)
  // Custom functions referenced by name (YAML/JSON rulesets) are loaded relative
  // to the declaring ruleset's directory and layered over the built-ins.
  let functions: FunctionRegistry = allFunctions
  const custom: FunctionRegistry = {}
  collectCustomFunctions(definitionOrDefault, basePath ?? process.cwd(), custom, new Set(), {
    ...trust,
    // A built-in preset name has no directory of its own, so there is nothing to
    // walk for custom functions.
    resolveExtend: (name, from) => (ASYNCAPI_RULESET_NAMES.has(name) ? undefined : resolve(name, from)),
  })
  if (Object.keys(custom).length > 0) functions = { ...allFunctions, ...custom }
  return createCoreRuleset(definitionOrDefault, {
    functions,
    formats: aasFormats,
    resolve,
    ...(basePath !== undefined ? { basePath } : {}),
  })
}
