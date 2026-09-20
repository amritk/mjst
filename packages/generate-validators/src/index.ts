import type { UnknownKeysStrategy } from '@amritk/helpers/unknown-keys-strategy'
import { type GeneratedFile, generate, type ImportExtension, type Mode } from '@amritk/parsers'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

export type { GeneratedFile }

/**
 * A compatibility shim, kept only so this package can be retired without
 * breaking anyone mid-upgrade.
 *
 * The validator engine moved into `@amritk/parsers`, which reaches it — and
 * every other mode — through one `generate()` call. Rather than re-export an
 * internal module across the package boundary, this maps the old positional
 * signature onto the public API, so `@amritk/parsers` keeps exactly one public
 * entry point and the engine stays an implementation detail of it.
 *
 * The output is byte-identical to what this package emitted before, barrel
 * included, which `index.test.ts` pins against the real pre-retirement engine
 * rather than against this shim's own idea of the answer.
 *
 * @deprecated Use `generate` from `@amritk/parsers`:
 * `generate(schema, name, { modes: ['types', 'validate'] })`.
 */
export const buildValidatorSchema = async (
  rootSchema: JSONSchema,
  rootTypeName: string,
  typeSuffix = '',
  schemas?: Readonly<Record<string, unknown>>,
  unknownKeys?: UnknownKeysStrategy,
  formats?: 'all' | readonly string[],
  coerce = false,
  branchErrors = false,
  repair = false,
  importExt: ImportExtension = 'js',
  check = false,
): Promise<GeneratedFile[]> => {
  // A plain build always emitted both `validateX` and `isX`, so both modes are
  // always on; the rest are the flags that used to switch extra halves in.
  const modes: Mode[] = [
    'types',
    'guard',
    'validate',
    ...(coerce ? (['coerce'] as const) : []),
    ...(repair ? (['repair'] as const) : []),
    ...(check ? (['check'] as const) : []),
  ]

  // Spread rather than pass `undefined`, because this repo compiles with
  // `exactOptionalPropertyTypes` and an explicit `undefined` is not the same as
  // an absent property there.
  return generate(rootSchema, rootTypeName, {
    modes,
    typeSuffix,
    branchErrors,
    importExt,
    ...(schemas !== undefined ? { schemas } : {}),
    ...(unknownKeys !== undefined ? { unknownKeys } : {}),
    ...(formats !== undefined ? { formats } : {}),
  })
}
