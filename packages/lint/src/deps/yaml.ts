/**
 * The parts of `@amritk/yaml` this package uses, loaded with the package.
 * `#deps/yaml` resolves here on a runtime that cannot `require()` an ES module,
 * where the synchronous parsers (`parseWithPointers`, `createDocument`, the fix
 * edits) have no later point to load it at; see `./yaml-lazy` for every other
 * runtime.
 */
export { isAlias, isMap, isPair, isScalar, isSeq, keyText, parseAllDocuments, parseDocument } from '@amritk/yaml'

/** Nothing to do: the static import above has loaded the module already. */
export const preloadYaml = async (): Promise<void> => {}
