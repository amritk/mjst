import { readFile } from 'node:fs/promises'
import { getAdapter } from '@amritk/adapters/get-adapter'
import { resolveRefsFromFile } from '@amritk/resolve-refs'

import type { CliConfig } from './cli-config'
import { hasExternalRefs } from './has-external-refs'
import { loadSchemaModule } from './load-schema-module'
import { buildResolveOptions, formatResolveErrors } from './resolve-policy'

/**
 * Reads a JSON Schema off disk, or loads a module and converts it via its adapter.
 *
 * For JSON input, a schema whose only references are same-document `#/...`
 * pointers is parsed as-is — the generator resolves those internal `$ref`s
 * itself into named type files, so inlining them here would collapse that
 * structure. When a cross-file or remote `$ref` is present (which the generator
 * cannot follow on its own), the schema is dereferenced with
 * `@amritk/resolve-refs`, inlining every external target into a single document.
 * Any resolve failures are surfaced as a CLI error rather than silently yielding
 * a half-resolved schema.
 *
 * Avro splits the difference, and is the reason this is not a plain
 * json/not-json branch: a `.avsc` is a JSON *document*, not a module exporting a
 * value, so it is read and parsed like a JSON Schema and only the conversion is
 * delegated to the adapter. Nothing is imported, which also means an Avro schema
 * — unlike a Zod or TypeBox one — never reaches module evaluation. Its `$ref`s
 * are Avro names resolved by the adapter, not JSON Pointers, so the resolver
 * does not run over it either.
 */
export const loadSchema = async (config: Partial<CliConfig>, schemaPath: string): Promise<unknown> => {
  const inputFormat = config.input ?? 'json'

  if (inputFormat === 'json') {
    const data: unknown = JSON.parse(await readFile(schemaPath, 'utf-8'))
    if (!hasExternalRefs(data)) return data

    const { resolved, errors } = await resolveRefsFromFile(schemaPath, buildResolveOptions(config, schemaPath))
    if (errors.length > 0) throw new Error(formatResolveErrors(schemaPath, errors))
    return resolved
  }

  console.log(`Input format: ${inputFormat}`)

  if (inputFormat === 'avro') {
    const source: unknown = JSON.parse(await readFile(schemaPath, 'utf-8'))
    return getAdapter(inputFormat).toJSONSchema(source)
  }

  const source = await loadSchemaModule(schemaPath, config.export)
  return getAdapter(inputFormat).toJSONSchema(source)
}
