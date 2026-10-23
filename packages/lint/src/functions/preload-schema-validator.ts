import type { Ruleset } from '../core/ruleset'
import type { RulesetFunction } from '../core/types'
import { builtinFunctions } from './index'
import { loadSchemaValidator, schema } from './schema'

// The built-ins that never reach `@amritk/runtime-validators`. Anything else a
// rule can run — `schema` itself, or a custom or preset function, which may call
// `schema` from inside — counts as needing it.
const SCHEMA_FREE_FUNCTIONS: ReadonlySet<RulesetFunction> = new Set(
  Object.values(builtinFunctions).filter((fn) => fn !== schema),
)

/**
 * Loads the `schema` function's validator before a run when one of the rules
 * that will run for `source` might need it, so a ruleset of plain style checks
 * never pays to import it. Unknown function names are left for the runner to
 * report.
 */
export const preloadSchemaValidator = async (ruleset: Ruleset, source: string | undefined): Promise<void> => {
  for (const rule of ruleset.rulesForSource(source)) {
    if (!rule.enabled) continue
    for (const then of rule.then) {
      // Resolved the way the runner does: a JS ruleset may hand over the function
      // itself, and a malformed `then` is skipped rather than tripped over.
      const named = then?.function
      const fn =
        typeof named === 'function' ? named : typeof named === 'string' ? ruleset.getFunction(named) : undefined
      if (fn !== undefined && !SCHEMA_FREE_FUNCTIONS.has(fn)) return loadSchemaValidator()
    }
  }
}
