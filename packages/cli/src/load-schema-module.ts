import { pathToFileURL } from 'node:url'

/**
 * Loads a schema authored as a JS/TS module and returns the exported schema value.
 *
 * Export selection, in order of preference:
 * 1. The export named by `exportName`, when provided (`--export <name>`).
 * 2. The module's default export.
 * 3. The sole named export, when there is exactly one.
 *
 * Anything else is ambiguous and throws, so the user can disambiguate explicitly
 * rather than have mjst guess wrong.
 *
 * Importing a `.ts` module requires a TypeScript-capable runtime (Bun, or Node
 * with a loader such as `tsx`). We surface a friendly hint when the import fails
 * for a `.ts` path so the cause is not a cryptic module-resolution error.
 */
export const loadSchemaModule = async (modulePath: string, exportName?: string): Promise<unknown> => {
  let mod: Record<string, unknown>

  try {
    mod = (await import(pathToFileURL(modulePath).href)) as Record<string, unknown>
  } catch (error) {
    const hint = modulePath.endsWith('.ts')
      ? ' Importing a .ts schema requires a TypeScript-capable runtime — run mjst via `bunx`, or install `tsx` and run Node with `--import tsx`.'
      : ''
    throw new Error(`Failed to load schema module at ${modulePath}.${hint}\n${String(error)}`)
  }

  if (exportName) {
    if (!(exportName in mod)) {
      throw new Error(`Schema module ${modulePath} has no export named '${exportName}'.`)
    }
    return mod[exportName]
  }

  if ('default' in mod && mod['default'] !== undefined) {
    return mod['default']
  }

  const namedKeys = Object.keys(mod).filter((key) => key !== 'default')

  if (namedKeys.length === 1) {
    const key = namedKeys[0]
    if (key) return mod[key]
  }

  throw new Error(
    `Schema module ${modulePath} exports ${namedKeys.length} values (${namedKeys.join(', ') || 'none'}). ` +
      `Specify which one to use with --export <name>.`,
  )
}
