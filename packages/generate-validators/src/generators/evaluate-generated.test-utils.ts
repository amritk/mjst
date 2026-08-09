import ts from 'typescript'

import { VALIDATION_RESULT_CONTENT } from './build-schema'

/**
 * Compiles a single generated validator source and returns its exports, with the
 * runtime helpers a generated file would import bound in scope.
 *
 * Those helpers (`valuesEqual`, `allUnique`, `escapePointer`) live in the emitted
 * `validation-result.ts`, so a test compiling one file in isolation has to supply
 * them. They are evaluated from {@link VALIDATION_RESULT_CONTENT} itself rather
 * than reimplemented here: every test file used to carry its own copy, and a copy
 * is a thing that drifts — a helper whose emitted version disagreed with the test
 * version would pass the test and ship broken.
 *
 * Use {@link linkGenerated} instead when a test needs a whole
 * `buildValidatorSchema` result (`$ref`s across files); this is for the
 * single-function case.
 *
 * The `.test-utils.ts` suffix keeps it out of the published build (see
 * `tsconfig.build.json`).
 */
const toJavaScript = (code: string): string =>
  ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText

/** The helper names generated code expects as free identifiers, in binding order. */
const HELPER_NAMES = ['valuesEqual', 'allUnique', 'escapePointer'] as const

const RUNTIME_HELPERS: readonly unknown[] = (() => {
  const moduleExports: Record<string, unknown> = {}
  new Function('exports', toJavaScript(VALIDATION_RESULT_CONTENT))(moduleExports)
  return HELPER_NAMES.map((name) => moduleExports[name])
})()

export const evaluateGenerated = (code: string): Record<string, unknown> => {
  const moduleExports: Record<string, unknown> = {}
  new Function('exports', ...HELPER_NAMES, toJavaScript(code))(moduleExports, ...RUNTIME_HELPERS)
  return moduleExports
}

/**
 * The single exported `validateX` from a generated validator source. A shorthand
 * for the overwhelmingly common `evaluateGenerated(...)` + pick-the-validator.
 */
export const evaluateValidator = (code: string): ((input: unknown, path?: string) => unknown) => {
  const moduleExports = evaluateGenerated(code)
  const name = Object.keys(moduleExports).find((exported) => exported.startsWith('validate'))
  return moduleExports[name ?? ''] as (input: unknown, path?: string) => unknown
}
