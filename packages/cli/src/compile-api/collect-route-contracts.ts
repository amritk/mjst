import type { AnyRouteContract } from '@amritk/api'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * A structural sniff, not a full validation: a route contract always declares
 * `method`, `path`, and `responses`, and nothing else in a typical routes
 * module (schemas, context factories, hooks, handlers) carries all three.
 * compileToModule does the strict checking (path syntax, duplicate routes,
 * identifier-safe names) with far better error messages than we could produce
 * here.
 */
const isRouteContract = (value: unknown): value is AnyRouteContract =>
  isRecord(value) &&
  typeof value['method'] === 'string' &&
  typeof value['path'] === 'string' &&
  isRecord(value['responses'])

/**
 * Picks the route contracts out of a loaded routes module, keyed by export
 * name — exactly the record `compileToModule` expects, since the generated
 * module imports each contract back by that name. Non-contract exports
 * (context factories, error formatters, hooks) are left alone; they are wired
 * in by name through the compile options instead.
 */
export const collectRouteContracts = (moduleExports: Record<string, unknown>): Record<string, AnyRouteContract> => {
  const routes: Record<string, AnyRouteContract> = {}

  for (const [name, value] of Object.entries(moduleExports)) {
    // The generated module does `import { <name> } from ...`, and `default`
    // is not importable that way — a contract must be a named export.
    if (name === 'default') continue
    if (isRouteContract(value)) routes[name] = value
  }

  return routes
}
