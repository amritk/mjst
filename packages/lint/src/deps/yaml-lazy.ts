import { createRequire } from 'node:module'
import type * as Yaml from '@amritk/yaml'

/**
 * The parts of `@amritk/yaml` this package uses, loaded on first use: linting a
 * JSON document never loads the YAML parser. `#deps/yaml` resolves here only
 * under the `bun` and `module-sync` conditions, which hold exactly where
 * `require()` can load an ES module, so the synchronous parsers still work before
 * anything has loaded it. `lint` loads it with `import()` first for a YAML
 * document. The node guards only ever see nodes a parse produced, by which point
 * the module is loaded.
 */

type Module = typeof Yaml

let loaded: Module | undefined

const load = (): Module => {
  loaded ??= createRequire(import.meta.url)('@amritk/yaml') as Module
  return loaded
}

/** Loads the module asynchronously, so a run that will parse YAML does not load it with `require()`. */
export const preloadYaml = async (): Promise<void> => {
  loaded ??= await import('@amritk/yaml')
}

export const parseAllDocuments: Module['parseAllDocuments'] = (source, options) =>
  load().parseAllDocuments(source, options)
export const parseDocument: Module['parseDocument'] = (source, options) => load().parseDocument(source, options)
export const keyText: Module['keyText'] = (node) => load().keyText(node)
export const isAlias = (node: unknown): node is Yaml.YamlAlias => load().isAlias(node)
export const isMap = (node: unknown): node is Yaml.YamlMap => load().isMap(node)
export const isPair = (node: unknown): node is Yaml.YamlPair => load().isPair(node)
export const isScalar = (node: unknown): node is Yaml.YamlScalar => load().isScalar(node)
export const isSeq = (node: unknown): node is Yaml.YamlSeq => load().isSeq(node)
