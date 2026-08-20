import { createRuleset as createCoreRuleset, type ResolvedExtend, type Ruleset } from '../../core'
import type { FunctionRegistry, RulesetDefinition } from '../../core/types'
import { builtinFunctions } from '../../functions'
import { collectCustomFunctions, type IRulesetTrustOptions, resolveRulesetFile } from '../../ruleset-files'
import { oasFormats } from './formats'
import { oasFunctions } from './functions/index'
import { oas } from './oas'

export type { IRulesetTrustOptions } from '../../ruleset-files'
export { oasFixers } from './fixers'
export { oas2, oas3, oas3_0, oas3_1, oas3_2, oasFormats } from './formats'
export { oasFunctions } from './functions/index'
export { oas } from './oas'
export { loadOasSchema, type OasVersion } from './schemas'

/** The built-in `@amritk/lint` functions plus the OpenAPI-specific ones, keyed by name. */
export const allFunctions: FunctionRegistry = { ...builtinFunctions, ...oasFunctions }

/** The names that resolve to the built-in OpenAPI ruleset (incl. the legacy Spectral alias). */
const OAS_RULESET_NAMES = new Set(['oas', 'loupe:oas', 'spectral:oas'])

/**
 * Resolves an `extends` reference to a ruleset definition. Extends the generic
 * file/package resolution with the OpenAPI preset names:
 * - `oas` / `loupe:oas` / `spectral:oas` → the built-in {@link oas} ruleset,
 * - local file paths (relative to `basePath`, or absolute): `.yaml` / `.yml` / `.json` / `.js`,
 * - npm package specifiers (resolved from `basePath`), including subpaths.
 *
 * As with the core `resolveNamedRuleset`, `basePath` is where resolution starts,
 * not a boundary: an absolute or `../`-escaping path is followed and a `.js`
 * target is `require`d. Pass `restrictTo` to confine resolution to one directory
 * tree when the ruleset is not fully trusted.
 */
export const resolveOpenApiRuleset = (
  name: string,
  basePath: string = process.cwd(),
  options: IRulesetTrustOptions = {},
): ResolvedExtend => {
  if (OAS_RULESET_NAMES.has(name)) return { definition: oas, basePath }
  return resolveRulesetFile(name, basePath, options)
}

/**
 * Builds a runnable {@link Ruleset} for OpenAPI, layering the built-in and
 * OpenAPI functions (plus any custom ones the definition declares), the OpenAPI
 * `formats`, and `extends` resolution that understands the `oas` / `loupe:oas` /
 * `spectral:oas` names. With no definition it defaults to `extends: [oas]`
 * (recommended rules only). Feed the result to `@amritk/lint`'s core
 * `lintWithResult` (with a `$ref` resolver for `resolved: true` rules).
 */
export const createOpenApiRuleset = (
  definition?: RulesetDefinition,
  basePath?: string,
  options: IRulesetTrustOptions = {},
): Ruleset => {
  // With no explicit ruleset, behave like `extends: [oas]` so only `recommended`
  // rules run by default. A user-supplied ruleset is used as-is (its own rules
  // run regardless of `recommended`).
  const definitionOrDefault: RulesetDefinition = definition ?? { extends: [oas] }
  const trust: IRulesetTrustOptions = options.restrictTo !== undefined ? { restrictTo: options.restrictTo } : {}
  const resolve = (name: string, from: string): ResolvedExtend => resolveOpenApiRuleset(name, from, trust)
  // Custom functions referenced by name (YAML/JSON rulesets) are loaded relative
  // to the declaring ruleset's directory and layered over the built-ins.
  let functions: FunctionRegistry = allFunctions
  const custom: FunctionRegistry = {}
  collectCustomFunctions(definitionOrDefault, basePath ?? process.cwd(), custom, new Set(), {
    ...trust,
    // A built-in preset name has no directory of its own, so there is nothing to
    // walk for custom functions.
    resolveExtend: (name, from) => (OAS_RULESET_NAMES.has(name) ? undefined : resolve(name, from)),
  })
  if (Object.keys(custom).length > 0) functions = { ...allFunctions, ...custom }
  return createCoreRuleset(definitionOrDefault, {
    functions,
    formats: oasFormats,
    resolve,
    ...(basePath !== undefined ? { basePath } : {}),
  })
}
