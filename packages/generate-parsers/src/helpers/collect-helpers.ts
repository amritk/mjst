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

const EMBEDDED_IMPORTS: Record<RuntimeHelperName, string> = {
  'is-object': "import { isObject } from './_helpers/is-object';",
  'validate-array': "import { validateArray } from './_helpers/validate-array';",
  'validate-record': "import { validateRecord } from './_helpers/validate-record';",
  'has-ref': "import { hasRef } from './_helpers/has-ref';",
}

/** Detects which runtime helpers a generated parser body references. */
export const collectHelpers = (parserFunction: string, mode: HelpersMode): CollectedHelpers => {
  const imports: string[] = []
  const used = new Set<RuntimeHelperName>()
  const table = mode === 'embedded' ? EMBEDDED_IMPORTS : PACKAGE_IMPORTS

  if (parserFunction.includes('validateArray')) {
    imports.push(table['validate-array'])
    used.add('validate-array')
  }

  if (parserFunction.includes('validateRecord')) {
    imports.push(table['validate-record'])
    used.add('validate-record')
    // The embedded validate-record.ts imports is-object, so it must be shipped too —
    // but only the `validate-record` line is needed in the parser file unless the
    // parser body itself references `isObject` (handled below).
    used.add('is-object')
  }

  if (parserFunction.includes('isObject')) {
    imports.push(table['is-object'])
    used.add('is-object')
  }

  if (parserFunction.includes('hasRef(')) {
    imports.push(table['has-ref'])
    used.add('has-ref')
  }

  return { imports, used }
}
