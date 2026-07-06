/** Names (without `.ts`) of runtime helpers that can be embedded into generated output. */
export type RuntimeHelperName = 'is-object' | 'validate-array' | 'validate-record' | 'has-ref'

/** Controls how generated parsers reference their runtime helpers. */
export type HelpersMode = 'package' | 'embedded'

export type CollectedHelpers = {
  /** Import lines to splice into the generated file. */
  readonly imports: string[]
  /**
   * Helper names that need to ship alongside the generated file in embedded mode.
   * Includes transitive deps (e.g. `validate-record` pulls in `is-object`) so the
   * orchestrator can emit a complete `_helpers/` directory.
   */
  readonly used: Set<RuntimeHelperName>
}

const PACKAGE_IMPORTS: Record<RuntimeHelperName, string> = {
  'is-object': "import { isObject } from '@amritk/helpers/is-object';",
  'validate-array': "import { validateArray } from '@amritk/helpers/validate-array';",
  'validate-record': "import { validateRecord } from '@amritk/helpers/validate-record';",
  // hasRef has historically lived in the schema-guards subpath; preserve that for package mode.
  'has-ref': "import { hasRef } from '@amritk/helpers/schema-guards';",
}

const EMBEDDED_NAMED_EXPORTS: Record<RuntimeHelperName, string> = {
  'is-object': 'isObject',
  'validate-array': 'validateArray',
  'validate-record': 'validateRecord',
  'has-ref': 'hasRef',
}

const embeddedImport = (helper: RuntimeHelperName, prefix: string, ext: 'js' | 'ts'): string =>
  // An explicit extension so the embedded-helper import resolves under Node ESM, not only Bun.
  `import { ${EMBEDDED_NAMED_EXPORTS[helper]} } from '${prefix}_helpers/${helper}.${ext}';`

/**
 * Detects which runtime helpers a generated parser body references.
 *
 * @param helpersImportPrefix - Relative path prefix to the shared `_helpers/`
 *   directory in embedded mode. Defaults to `'./'`. The recursive multi-schema
 *   build passes `'../'`, `'../../'`, etc. so nested parsers can reach a single
 *   `_helpers/` directory at the output root.
 * @param importExt - Extension used on embedded-helper import specifiers.
 *   Defaults to `'js'` (the TS NodeNext form); `'ts'` makes the output runnable
 *   under Node's type stripping.
 */
// One alternation pass over the generated source instead of four full-text
// `.includes` scans — an absent helper name used to cost a complete rescan
// each, which showed up at several percent of total generation time.
const HELPER_USAGE = /validateArray|validateRecord|isObject|hasRef\(/g

export const collectHelpers = (
  parserFunction: string,
  mode: HelpersMode,
  helpersImportPrefix = './',
  importExt: 'js' | 'ts' = 'js',
): CollectedHelpers => {
  const imports: string[] = []
  const used = new Set<RuntimeHelperName>()
  const importFor = (helper: RuntimeHelperName): string =>
    mode === 'embedded' ? embeddedImport(helper, helpersImportPrefix, importExt) : PACKAGE_IMPORTS[helper]

  let sawValidateArray = false
  let sawValidateRecord = false
  let sawIsObject = false
  let sawHasRef = false
  HELPER_USAGE.lastIndex = 0
  let match = HELPER_USAGE.exec(parserFunction)
  while (match !== null) {
    const token = match[0]
    if (token === 'validateArray') sawValidateArray = true
    else if (token === 'validateRecord') sawValidateRecord = true
    else if (token === 'isObject') sawIsObject = true
    else sawHasRef = true
    if (sawValidateArray && sawValidateRecord && sawIsObject && sawHasRef) break
    match = HELPER_USAGE.exec(parserFunction)
  }

  if (sawValidateArray) {
    imports.push(importFor('validate-array'))
    used.add('validate-array')
  }

  if (sawValidateRecord) {
    imports.push(importFor('validate-record'))
    used.add('validate-record')
    // The embedded validate-record.ts imports is-object, so it must be shipped too —
    // but only the `validate-record` line is needed in the parser file unless the
    // parser body itself references `isObject` (handled below).
    used.add('is-object')
  }

  if (sawIsObject) {
    imports.push(importFor('is-object'))
    used.add('is-object')
  }

  if (sawHasRef) {
    imports.push(importFor('has-ref'))
    used.add('has-ref')
  }

  return { imports, used }
}
