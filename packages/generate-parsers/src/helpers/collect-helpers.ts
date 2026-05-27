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

const embeddedImport = (helper: RuntimeHelperName, prefix: string): string =>
  `import { ${EMBEDDED_NAMED_EXPORTS[helper]} } from '${prefix}_helpers/${helper}';`

/**
 * Detects which runtime helpers a generated parser body references.
 *
 * @param helpersImportPrefix - Relative path prefix to the shared `_helpers/`
 *   directory in embedded mode. Defaults to `'./'`. The recursive multi-schema
 *   build passes `'../'`, `'../../'`, etc. so nested parsers can reach a single
 *   `_helpers/` directory at the output root.
 */
export const collectHelpers = (
  parserFunction: string,
  mode: HelpersMode,
  helpersImportPrefix = './',
): CollectedHelpers => {
  const imports: string[] = []
  const used = new Set<RuntimeHelperName>()
  const importFor = (helper: RuntimeHelperName): string =>
    mode === 'embedded' ? embeddedImport(helper, helpersImportPrefix) : PACKAGE_IMPORTS[helper]

  if (parserFunction.includes('validateArray')) {
    imports.push(importFor('validate-array'))
    used.add('validate-array')
  }

  if (parserFunction.includes('validateRecord')) {
    imports.push(importFor('validate-record'))
    used.add('validate-record')
    // The embedded validate-record.ts imports is-object, so it must be shipped too —
    // but only the `validate-record` line is needed in the parser file unless the
    // parser body itself references `isObject` (handled below).
    used.add('is-object')
  }

  if (parserFunction.includes('isObject')) {
    imports.push(importFor('is-object'))
    used.add('is-object')
  }

  if (parserFunction.includes('hasRef(')) {
    imports.push(importFor('has-ref'))
    used.add('has-ref')
  }

  return { imports, used }
}
