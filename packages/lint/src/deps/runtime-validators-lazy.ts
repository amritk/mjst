import { createRequire } from 'node:module'
import type * as RuntimeValidators from '@amritk/runtime-validators'

/**
 * `@amritk/runtime-validators`, loaded on first use. A lint run whose rules never
 * validate a schema never loads it. `#deps/runtime-validators` resolves here only under the `bun` and
 * `module-sync` conditions, which hold exactly where `require()` can load an ES
 * module, so a synchronous caller such as `schema()` still works before anything
 * has loaded it. `Linter.run` loads it with `import()` first when a rule needs it.
 */

type Module = typeof RuntimeValidators

let loaded: Module | undefined

const load = (): Module => {
  loaded ??= createRequire(import.meta.url)('@amritk/runtime-validators') as Module
  return loaded
}

/** Loads the module asynchronously, so a run that will use it does not load it with `require()`. */
export const preloadRuntimeValidators = async (): Promise<void> => {
  loaded ??= await import('@amritk/runtime-validators')
}

export const validate: Module['validate'] = (schema, options) => load().validate(schema, options)
