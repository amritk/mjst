/**
 * `@amritk/runtime-validators`, loaded with the package. `#deps/runtime-validators`
 * resolves here on a runtime that cannot `require()` an ES module, where a
 * synchronous caller such as `schema()` has no later point to load it at; see
 * `./runtime-validators-lazy` for every other runtime.
 */
export { validate } from '@amritk/runtime-validators'

/** Nothing to do: the static import above has loaded the module already. */
export const preloadRuntimeValidators = async (): Promise<void> => {}
