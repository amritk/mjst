import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, resolve as resolvePath, sep } from 'node:path'

import type { ResolvedExtend } from './core'
import type { FunctionRegistry, RulesetDefinition, RulesetFunction } from './core/types'
import { parseWithPointers } from './parsers'

/**
 * Everything a ruleset pulls off disk: `extends` targets and the custom function
 * modules a YAML/JSON ruleset names. This lives in one module rather than one
 * function per file because the four pieces are a single concern — reading a
 * ruleset's dependencies — and because both entry points that need them
 * (`@amritk/lint` and `@amritk/lint/rules/openapi`) must behave *identically*.
 * They used to carry a copy each, and the copies drifted: only one grew the
 * `restrictTo` fence, and only one keyed its cycle guard by resolved file so a
 * two-file `extends` cycle did not recurse forever.
 */

const require = createRequire(import.meta.url)

/**
 * An optional directory that everything a ruleset pulls off disk — `extends`
 * targets and custom function modules — must resolve inside.
 *
 * This is opt-in and off by default, because `basePath` on its own is only a
 * *resolution origin*: an `extends` of `/etc/thing.js` or `../../../elsewhere`
 * resolves and loads exactly as written. See the "Trust boundary" section of the
 * README — a ruleset that can name a `.js` file can run code, restricted root or
 * not. This narrows *which* files it can name; it is not a sandbox.
 */
export type IRulesetTrustOptions = {
  /** Directory that `extends` files and custom functions must resolve under. */
  restrictTo?: string
}

/** Enforces {@link IRulesetTrustOptions.restrictTo}, if one was configured, on a resolved file path. */
export const assertWithinRoot = (file: string, restrictTo: string | undefined, what: string): void => {
  if (restrictTo === undefined) return
  const root = resolvePath(restrictTo)
  const resolved = resolvePath(file)
  // `${root}${sep}` — a sibling directory whose name merely starts with the root
  // ("/srv/rules-other" for a root of "/srv/rules") must not pass.
  if (resolved !== root && !resolved.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)) {
    throw new Error(`${what} "${file}" resolves outside the permitted root ${root}`)
  }
}

/** Loads a ruleset definition from a file path by extension (YAML/JSON parsed, JS/CJS/MJS required). */
export const loadRulesetFile = (file: string): RulesetDefinition => {
  if (/\.(ya?ml|json)$/i.test(file)) {
    return parseWithPointers<RulesetDefinition>(readFileSync(file, 'utf8')).data
  }
  const module = require(file) as { default?: RulesetDefinition } & RulesetDefinition
  return (module.default ?? module) as RulesetDefinition
}

/**
 * Resolves an `extends` reference that names a file or an npm package:
 * - local file paths (relative to `basePath`, or absolute): `.yaml` / `.yml` / `.json` / `.js`,
 * - npm package specifiers (resolved from `basePath`), including subpaths.
 *
 * Callers that also recognize named presets (`@amritk/lint/rules/openapi` knows
 * `oas`) check those first and only fall through to here.
 */
export const resolveRulesetFile = (
  name: string,
  basePath: string,
  options: IRulesetTrustOptions = {},
): ResolvedExtend => {
  if (name.startsWith('.') || isAbsolute(name)) {
    const file = resolvePath(basePath, name)
    assertWithinRoot(file, options.restrictTo, 'Extended ruleset')
    return { definition: loadRulesetFile(file), basePath: dirname(file) }
  }
  let file: string
  try {
    file = require.resolve(name, { paths: [basePath] })
  } catch {
    throw new Error(`Cannot resolve extended ruleset "${name}" from ${basePath}`)
  }
  assertWithinRoot(file, options.restrictTo, 'Extended ruleset')
  return { definition: loadRulesetFile(file), basePath: dirname(file) }
}

/** Loads a single custom function module (`<dir>/<name>.{js,cjs,mjs}` or a bare path). */
export const loadFunctionByName = (
  basePath: string,
  dir: string,
  name: string,
  restrictTo: string | undefined,
): RulesetFunction => {
  const baseFile = resolvePath(basePath, dir, name)
  assertWithinRoot(baseFile, restrictTo, 'Custom function')
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

/** How {@link collectCustomFunctions} follows a string `extends` target. */
export type ICollectOptions = IRulesetTrustOptions & {
  /**
   * Resolves a string `extends` target to its definition and base directory.
   * Return `undefined` for a name that is a built-in preset rather than a file —
   * such a target has no directory of its own to load functions from.
   */
  resolveExtend: (name: string, basePath: string) => ResolvedExtend | undefined
}

/**
 * Walks a ruleset definition (and its string `extends`) collecting custom
 * functions declared via `functions` / `functionsDir`, each loaded relative to
 * the directory of the ruleset that declared it. YAML/JSON rulesets reference
 * functions by name; JS rulesets can instead pass direct references in `then`.
 */
export const collectCustomFunctions = (
  definition: RulesetDefinition,
  basePath: string,
  into: FunctionRegistry,
  // Keyed by (basePath, reference) for string extends and by object identity for
  // inline ones. `loadRulesetFile` returns a fresh object per read, so object
  // identity alone would never dedupe a file cycle — we key on the resolved edge.
  // Without the edge key, `a.yaml` extending `b.yaml` extending `a.yaml` recursed
  // until the stack ran out.
  seen: Set<unknown>,
  options: ICollectOptions,
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
        const resolved = options.resolveExtend(target, basePath)
        if (resolved) collectCustomFunctions(resolved.definition, resolved.basePath, into, seen, options)
      } else {
        collectCustomFunctions(target, basePath, into, seen, options)
      }
    }
  }
  if (Array.isArray(definition.functions)) {
    const dir = definition.functionsDir ?? 'functions'
    for (const name of definition.functions) into[name] = loadFunctionByName(basePath, dir, name, options.restrictTo)
  }
}
