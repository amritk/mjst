import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Reads a template file relative to this helper's location.
 *
 * Used as a Bun macro (`with { type: 'macro' }`) so the file content is inlined
 * into the bundle at build time, but still works at module-load time during
 * development and tests when the macro is invoked as a regular function call.
 */
export const readTemplate = (relativePath: string): string => {
  const dir = dirname(fileURLToPath(import.meta.url))
  return readFileSync(join(dir, relativePath), 'utf-8')
}
