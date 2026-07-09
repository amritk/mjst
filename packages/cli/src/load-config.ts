import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { SourceFormat } from '@amritk/adapters/source-format'

import type { CliConfig } from './cli-config'

const SOURCE_FORMATS: readonly string[] = ['json', 'typebox', 'zod', 'valibot', 'effect']

const isSourceFormat = (value: unknown): value is SourceFormat =>
  typeof value === 'string' && SOURCE_FORMATS.includes(value)

const isHelpersMode = (value: unknown): value is 'package' | 'embedded' => value === 'package' || value === 'embedded'

const isImportExt = (value: unknown): value is 'js' | 'ts' => value === 'js' || value === 'ts'

/**
 * Loads a JSON config file and returns the relevant CLI config properties.
 * The config file should have the same keys as the CLI flags (schema, outDir).
 */
export const loadConfig = async (configPath: string): Promise<Partial<CliConfig>> => {
  const absolutePath = resolve(configPath)
  const raw = await readFile(absolutePath, 'utf-8')
  const parsed: unknown = JSON.parse(raw)

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Config file must be a JSON object: ${configPath}`)
  }

  const obj = parsed as Record<string, unknown>

  return {
    ...(typeof obj['schema'] === 'string' && { schema: obj['schema'] }),
    ...(typeof obj['schemaDir'] === 'string' && { schemaDir: obj['schemaDir'] }),
    ...(typeof obj['outDir'] === 'string' && { outDir: obj['outDir'] }),
    ...(typeof obj['outFile'] === 'string' && { outFile: obj['outFile'] }),
    ...(isSourceFormat(obj['input']) && { input: obj['input'] }),
    ...(typeof obj['export'] === 'string' && { export: obj['export'] }),
    ...(typeof obj['typesOnly'] === 'boolean' && { typesOnly: obj['typesOnly'] }),
    ...(typeof obj['build'] === 'boolean' && { build: obj['build'] }),
    ...(typeof obj['logWarnings'] === 'boolean' && { logWarnings: obj['logWarnings'] }),
    ...(typeof obj['strict'] === 'boolean' && { strict: obj['strict'] }),
    ...(typeof obj['stripUnknown'] === 'boolean' && { stripUnknown: obj['stripUnknown'] }),
    ...(typeof obj['caseInsensitive'] === 'boolean' && { caseInsensitive: obj['caseInsensitive'] }),
    ...(typeof obj['readonly'] === 'boolean' && { readonly: obj['readonly'] }),
    ...(isHelpersMode(obj['helpers']) && { helpers: obj['helpers'] }),
    ...(isImportExt(obj['importExt']) && { importExt: obj['importExt'] }),
    ...(typeof obj['rootType'] === 'string' && { rootType: obj['rootType'] }),
    ...(typeof obj['typeSuffix'] === 'string' && { typeSuffix: obj['typeSuffix'] }),
    // `banner` is a boolean toggle or a custom header string, mirroring the CLI flag.
    ...((typeof obj['banner'] === 'boolean' || typeof obj['banner'] === 'string') && { banner: obj['banner'] }),
  }
}
