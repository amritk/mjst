import { pathToFileURL } from 'node:url'

/**
 * Imports the user's routes module and returns the full export record —
 * compile-api needs every export (each one is a route-contract candidate), so
 * it cannot reuse loadSchemaModule, which selects a single export. The import
 * mechanics and the friendly `.ts` hint mirror load-schema-module.ts: a `.ts`
 * module only loads under a TypeScript-capable runtime.
 */
export const loadRoutesModule = async (modulePath: string): Promise<Record<string, unknown>> => {
  try {
    return (await import(pathToFileURL(modulePath).href)) as Record<string, unknown>
  } catch (error) {
    const hint = modulePath.endsWith('.ts')
      ? ' Importing a .ts routes module requires a TypeScript-capable runtime — run mjst via `bunx`, or install `tsx` and run Node with `--import tsx`.'
      : ''
    throw new Error(`Failed to load routes module at ${modulePath}.${hint}\n${String(error)}`)
  }
}
