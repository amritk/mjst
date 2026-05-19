import { createRequire } from 'node:module'
import { resolve } from 'node:path'

/**
 * Detects whether `@amritk/helpers` is resolvable from the consumer's output
 * directory using standard Node module resolution (walks up `node_modules`).
 *
 * Returns `'package'` when generated parsers can safely
 * `import { ... } from '@amritk/helpers/...'` at runtime, or `'embedded'`
 * when the helper sources need to be shipped alongside the generated files
 * for the output to be self-contained.
 */
export const detectHelpersMode = (outputDir: string): 'package' | 'embedded' => {
  const req = createRequire(resolve(outputDir, 'noop.js'))
  try {
    req.resolve('@amritk/helpers/is-object')
    return 'package'
  } catch {
    return 'embedded'
  }
}
