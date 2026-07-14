import { validateArray } from '@amritk/helpers/validate-array'
import { validateRecord } from '@amritk/helpers/validate-record'
import { transformSync } from 'esbuild'

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
 * job in ~2ms. The `isObject`, `validateArray`, and `validateRecord` runtime
 * helpers the generated code imports are injected directly — the array/record
 * helpers are the *real* ones, so the identity-return fast paths behave exactly
 * as shipped.
 */
export const evalGenerated = <T>(code: string, exportName: string): T => {
  const js = transformSync(code, { loader: 'ts', format: 'cjs', target: 'es2022' }).code
  // esbuild's ESM→CJS wrapper *reassigns* module.exports, so a bare `exports`
  // binding would stay empty — hand it a real module object.
  const mod = { exports: {} as Record<string, unknown> }
  const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
  new Function('module', 'exports', 'isObject', 'validateArray', 'validateRecord', js)(
    mod,
    mod.exports,
    isObject,
    validateArray,
    validateRecord,
  )
  return mod.exports[exportName] as T
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
