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
  const source = await loadSchemaModule(schemaPath, config.export)
  return getAdapter(inputFormat).toJSONSchema(source)
}
