import { type GeneratedFile, generate } from '@amritk/parsers'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import type { CliConfig } from './cli-config'
import { resolveImportExt } from './resolve-import-ext'
import { resolveModes } from './resolve-modes'

/** Where one schema's generated files reach their runtime helpers from. */
export type HelpersPlacement = {
  /** The published package, or helper sources emitted into the output tree. */
  readonly mode: 'package' | 'embedded'
  /**
   * Relative path from this schema's output subdirectory back to the shared
   * `_helpers/` at the output root. The recursive flows nest a schema's files a
   * directory or more down, so `./` is only right at the top.
   */
  readonly importPrefix?: string
}

/**
 * Generates one schema's files, translating the CLI's flags into the single
 * options object `@amritk/parsers` takes.
 *
 * All four generation flows come through here so none of them can quietly hold a
 * different opinion about what a flag means — which is exactly what happened
 * while the CLI drove the two generators directly and positionally: the AsyncAPI
 * flow passed `--unknown-keys` to the validators and forgot it for the parsers.
 */
export const generateFiles = async (
  config: Partial<CliConfig>,
  schema: JSONSchema,
  rootTypeName: string,
  helpers: HelpersPlacement,
): Promise<GeneratedFile[]> =>
  generate(schema, rootTypeName, {
    modes: resolveModes(config),
    typeSuffix: config.typeSuffix ?? '',
    branchErrors: config.branchErrors === true,
    stripUnknown: config.stripUnknown === true,
    readonly: config.readonly === true,
    caseInsensitive: config.caseInsensitive === true,
    helpersMode: helpers.mode,
    helpersImportPrefix: helpers.importPrefix ?? './',
    importExt: resolveImportExt(config),
    logWarnings: config.logWarnings === true,
    // Spread rather than passed as `undefined`: under
    // `exactOptionalPropertyTypes` an absent option and one set to `undefined`
    // are different things, and only the first falls back to the generator's own
    // default.
    ...(config.unknownKeys !== undefined ? { unknownKeys: config.unknownKeys } : {}),
    ...(config.formats !== undefined ? { formats: config.formats } : {}),
  })
