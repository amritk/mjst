import type { UnknownKeysStrategy } from '@amritk/helpers/unknown-keys-strategy'
import { type GeneratedFile, type GenerateOptions, generate, type ImportExtension, type Mode } from '@amritk/parsers'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

export type { GeneratedFile, ImportExtension }

/**
 * A compatibility shim, kept only so this package can be retired without
 * breaking anyone mid-upgrade.
 *
 * The parser and type engine moved into `@amritk/parsers`, which reaches it —
 * and every other mode — through one `generate()` call. Rather than re-export an
 * internal module across the package boundary, this maps the old positional
 * signature onto the public API, so `@amritk/parsers` keeps exactly one public
 * entry point and the engine stays an implementation detail of it.
 *
 * The output is byte-identical to what this package emitted before, barrel
 * included, which `index.test.ts` pins against the real pre-retirement engine
 * rather than against this shim's own idea of the answer.
 *
 * @deprecated Use `generate` from `@amritk/parsers`:
 * `generate(schema, name, { modes: ['types', 'parse'] })`.
 */
export const buildSchema = async (
  rootSchema: JSONSchema,
  rootTypeName: string,
  extensions?: GenerateOptions['extensions'],
  typesOnly?: boolean,
  logWarnings?: boolean,
  strict?: boolean,
  helpersMode: 'package' | 'embedded' = 'package',
  helpersImportPrefix = './',
  readonly = false,
  stripUnknown = false,
  typeSuffix = '',
  importExt: ImportExtension = 'js',
  caseInsensitive = false,
  schemas?: Readonly<Record<string, unknown>>,
  unknownKeys?: UnknownKeysStrategy,
): Promise<GeneratedFile[]> => {
  // `typesOnly` wins over `strict`, exactly as it did before: a build with no
  // runtime has no parser for `strict` to shape.
  const modes: Mode[] = typesOnly === true ? ['types'] : ['types', strict === true ? 'parseStrict' : 'parse']

  // Spread rather than pass `undefined`, because this repo compiles with
  // `exactOptionalPropertyTypes` and an explicit `undefined` is not the same as
  // an absent property there.
  return generate(rootSchema, rootTypeName, {
    modes,
    helpersMode,
    helpersImportPrefix,
    readonly,
    stripUnknown,
    typeSuffix,
    importExt,
    caseInsensitive,
    logWarnings: logWarnings === true,
    ...(extensions !== undefined ? { extensions } : {}),
    ...(schemas !== undefined ? { schemas } : {}),
    ...(unknownKeys !== undefined ? { unknownKeys } : {}),
  })
}
