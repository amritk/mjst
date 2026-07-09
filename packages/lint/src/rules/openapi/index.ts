import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, resolve as resolvePath } from 'node:path'

import {
  createRuleset as createCoreRuleset,
  type FunctionRegistry,
  type ResolvedExtend,
  type Ruleset,
  type RulesetDefinition,
  type RulesetFunction,
} from '../../core'
import { builtinFunctions } from '../../functions'
import { parseWithPointers } from '../../parsers'
import { oasFormats } from './formats'
import { oasFunctions } from './functions/index'
import { oas } from './oas'

export { oasFixers } from './fixers'
export { oas2, oas3, oas3_0, oas3_1, oas3_2, oasFormats } from './formats'
export { oasFunctions } from './functions/index'
export { oas } from './oas'
export { oas2Schema } from './schemas/oas2'
export { oas3Schema } from './schemas/oas3'
export { oas31Schema } from './schemas/oas31'
export { oas32Schema } from './schemas/oas32'

/** The built-in `@amritk/lint` functions plus the OpenAPI-specific ones, keyed by name. */
export const allFunctions: FunctionRegistry = { ...builtinFunctions, ...oasFunctions }

const require = createRequire(import.meta.url)

/** The names that resolve to the built-in OpenAPI ruleset (incl. the legacy Spectral alias). */
const OAS_RULESET_NAMES = new Set(['oas', 'loupe:oas', 'spectral:oas'])

/** Loads a ruleset definition from a file path by extension (YAML/JSON parsed, JS/CJS/MJS required). */
const loadRulesetFile = (file: string): RulesetDefinition => {
  if (/\.(ya?ml|json)$/i.test(file)) {
    return parseWithPointers<RulesetDefinition>(readFileSync(file, 'utf8')).data
  }
  const module = require(file) as { default?: RulesetDefinition } & RulesetDefinition
  return (module.default ?? module) as RulesetDefinition
}

/**
 * Resolves an `extends` reference to a ruleset definition. Extends the generic
 * file/package resolution with the OpenAPI preset names:
 * - `oas` / `loupe:oas` / `spectral:oas` → the built-in {@link oas} ruleset,
 * - local file paths (relative to `basePath`, or absolute): `.yaml` / `.yml` / `.json` / `.js`,
 * - npm package specifiers (resolved from `basePath`), including subpaths.
 */
export const resolveOpenApiRuleset = (name: string, basePath: string = process.cwd()): ResolvedExtend => {
  if (OAS_RULESET_NAMES.has(name)) return { definition: oas, basePath }
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
 * the directory of the ruleset that declared it. The built-in `oas` names carry
 * no custom functions, so they are skipped.
 */
const collectCustomFunctions = (
  definition: RulesetDefinition,
  basePath: string,
  into: FunctionRegistry,
  seen: Set<RulesetDefinition>,
): void => {
  if (seen.has(definition)) return
  seen.add(definition)
  if (definition.extends) {
    const entries = Array.isArray(definition.extends) ? definition.extends : [definition.extends]
    for (const entry of entries) {
      const target = Array.isArray(entry) ? entry[0] : entry
      if (typeof target === 'string') {
        if (OAS_RULESET_NAMES.has(target)) continue
        const resolved = resolveOpenApiRuleset(target, basePath)
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
 * Builds a runnable {@link Ruleset} for OpenAPI, layering the built-in and
 * OpenAPI functions (plus any custom ones the definition declares), the OpenAPI
 * `formats`, and `extends` resolution that understands the `oas` / `loupe:oas` /
 * `spectral:oas` names. With no definition it defaults to `extends: [oas]`
 * (recommended rules only). Feed the result to `@amritk/lint`'s core
 * `lintWithResult` (with a `$ref` resolver for `resolved: true` rules).
 */
export const createOpenApiRuleset = (definition?: RulesetDefinition, basePath?: string): Ruleset => {
  // With no explicit ruleset, behave like `extends: [oas]` so only `recommended`
  // rules run by default. A user-supplied ruleset is used as-is (its own rules
  // run regardless of `recommended`).
  const resolved: RulesetDefinition = definition ?? { extends: [oas] }
  // Custom functions referenced by name (YAML/JSON rulesets) are loaded relative
  // to the declaring ruleset's directory and layered over the built-ins.
  let functions: FunctionRegistry = allFunctions
  const custom: FunctionRegistry = {}
  collectCustomFunctions(resolved, basePath ?? process.cwd(), custom, new Set())
  if (Object.keys(custom).length > 0) functions = { ...allFunctions, ...custom }
  return createCoreRuleset(resolved, {
    functions,
    formats: oasFormats,
    resolve: resolveOpenApiRuleset,
    ...(basePath !== undefined ? { basePath } : {}),
  })
}
