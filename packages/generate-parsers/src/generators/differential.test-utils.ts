import { hasExactKeyCount } from '@amritk/helpers/has-exact-key-count'
import { validateArray } from '@amritk/helpers/validate-array'
import { validateRecord } from '@amritk/helpers/validate-record'
import { transformSync } from 'esbuild'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { generateParserFunction, generateShapeValidator } from './generate-parser-function'

/**
 * Shared harness for the differential fuzz suites (and any test that executes
 * generated parser source): compile-and-eval, a deterministic RNG, and the
 * shared property-key pool. Extracted so the fuzzers can't drift — when the
 * generated code grows a new injected runtime helper, this is the one place
 * to add it. The `.test-utils.ts` suffix keeps it out of the published build
 * (see tsconfig.build.json) since it imports the esbuild devDependency.
 */

/**
 * Compiles generated parser source and returns the named export, so tests run
 * real inputs through the emitted code instead of only asserting on its text.
 * esbuild strips the types — `ts.transpileModule` cost ~14ms per parser,
 * which dominated the suite across ~4k fuzz compiles; esbuild does the same
 * job in ~2ms. The `isObject`, `validateArray`, `validateRecord`, and
 * `hasExactKeyCount` runtime helpers the generated code imports are injected
 * directly — all but `isObject` are the *real* ones, so the identity-return and
 * no-extras fast paths behave exactly as shipped.
 */
export const evalGenerated = <T>(code: string, exportName: string): T => {
  const js = transformSync(code, { loader: 'ts', format: 'cjs', target: 'es2022' }).code
  // esbuild's ESM→CJS wrapper *reassigns* module.exports, so a bare `exports`
  // binding would stay empty — hand it a real module object.
  const mod = { exports: {} as Record<string, unknown> }
  const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
  new Function('module', 'exports', 'isObject', 'validateArray', 'validateRecord', 'hasExactKeyCount', js)(
    mod,
    mod.exports,
    isObject,
    validateArray,
    validateRecord,
    hasExactKeyCount,
  )
  return mod.exports[exportName] as T
}

/**
 * Generates the parser exactly the way generate-files lays out a file: the
 * exported shape validator first, then the parser handed that validator's
 * source so its fast-path guard can delegate to it instead of inlining a
 * duplicate check chain. The fuzz suites compile through this so they
 * exercise the shipped pairing, not just the standalone parser.
 */
export const generateFileParser = (
  schema: JSONSchema,
  typeName: string,
  options?: { readonly strict?: boolean; readonly stripUnknown?: boolean },
): string => {
  const stripUnknown = options?.stripUnknown ?? false
  const shapeValidator = generateShapeValidator(schema, typeName, false, '', true, stripUnknown)
  const parser = generateParserFunction(schema, typeName, {
    ...options,
    shapeValidatorSource: shapeValidator,
  })
  return `${shapeValidator}\n\n${parser}`
}

/** Deterministic mulberry32-style RNG so fuzz failures reproduce across runs. */
export const makeRng = (seed: number): (() => number) => {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const pick = <T>(rng: () => number, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)] as T

/** Property-key pool shared by every schema fuzzer. */
export const KEYS = ['id', 'name', 'tags', 'role', 'x']

/**
 * Compiles and links a whole `buildSchema` result in memory, returning one named
 * export from it.
 *
 * {@link evalGenerated} handles the single-file case, where the harness can inject
 * the runtime helpers by hand. A `$ref`-carrying schema produces a *set* of files
 * that import each other, and only the whole set is runnable — so this resolves
 * those imports against the generated output itself. Generate with
 * `helpersMode: 'embedded'` and the helper modules are part of that output too,
 * which makes the linked result self-contained.
 *
 * Recursive schemas produce genuinely cyclic modules, so a module is registered
 * *before* its body runs, as a live view onto its exports rather than a snapshot:
 * esbuild's ESM→CJS wrapper reassigns `module.exports` wholesale, and a snapshot
 * taken beforehand would stay empty.
 */
export const linkGenerated = <T>(
  files: readonly { readonly filename: string; readonly content: string }[],
  entry: string,
  exportName: string,
): T => {
  const sources = new Map(files.map((file) => [moduleKey(file.filename), file.content]))
  const loaded = new Map<string, Record<string, unknown>>()

  const load = (specifier: string, fromDir: string): Record<string, unknown> => {
    const key = moduleKey(specifier, fromDir)
    const cached = loaded.get(key)
    if (cached !== undefined) return cached
    const source = sources.get(key)
    if (source === undefined) throw new Error(`generated output has no module "${specifier}"`)

    const module = { exports: {} as Record<string, unknown> }
    loaded.set(key, exportsView(module))
    const js = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code
    const dir = key.includes('/') ? key.slice(0, key.lastIndexOf('/')) : ''
    new Function('module', 'exports', 'require', js)(module, module.exports, (nested: string) => load(nested, dir))
    return exportsView(module)
  }

  return load(entry, '')[exportName] as T
}

/**
 * Resolves a specifier to the key its file is registered under: extensions
 * dropped, and a relative import resolved against the importing module's own
 * directory (a helper under `_helpers/` imports its siblings as `./x.js`).
 */
const moduleKey = (specifier: string, fromDir = ''): string => {
  const bare = specifier.replace(/^\.\//, '').replace(/\.(js|ts)$/, '')
  return fromDir === '' ? bare : `${fromDir}/${bare}`
}

/**
 * A live view onto `module.exports` — reads forward to whatever object
 * `module.exports` currently is, which is what makes a cyclic import work.
 */
const exportsView = (module: { exports: Record<string, unknown> }): Record<string, unknown> =>
  new Proxy({} as Record<string, unknown>, {
    get: (_target, property) => module.exports[property as string],
    has: (_target, property) => property in module.exports,
    ownKeys: () => Reflect.ownKeys(module.exports),
    getOwnPropertyDescriptor: (_target, property) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(module.exports, property)
      return descriptor === undefined ? undefined : { ...descriptor, configurable: true }
    },
  })
