import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { getAdapter } from '@amritk/adapters/get-adapter'
import { type ResolveError, resolveRefsFromFile } from '@amritk/resolve-refs'

import { withAllowedRootsHint } from './allowed-roots-hint'
import type { CliConfig } from './cli-config'
import { hasExternalRefs } from './has-external-refs'
import { loadSchemaModule } from './load-schema-module'

/**
 * Builds the `@amritk/resolve-refs` options from the CLI config, mirroring the
 * safety posture of `mjst lint`: remote (`http(s)`) `$ref`s are refused unless
 * opted into, a non-empty `allowedHosts` implies remote fetching, private/
 * loopback hosts stay blocked as an SSRF guard unless explicitly permitted, and
 * a local `$ref` may not leave the schema's own directory unless `allowedRoots`
 * names somewhere else.
 *
 * `allowedRoots` is passed only when the user asked for it, and it *adds* to the
 * schema's own directory rather than replacing it. The library option replaces
 * the default outright, which would make `--allowed-roots ../common` quietly
 * revoke the folder the schema itself lives in — the one directory a user would
 * never think to list. Entries are resolved against the process cwd (both from
 * the flag and from a config file), matching how `schema` and `outDir` are
 * treated in `cli.ts`.
 */
const buildResolveOptions = (config: Partial<CliConfig>, schemaPath: string) => {
  // A non-empty allow-list is itself an opt-in to remote fetching.
  const remote = (config.resolveRemote ?? false) || (config.allowedHosts?.length ?? 0) > 0
  const extraRoots = (config.allowedRoots ?? []).map((root) => resolve(root))
  return {
    remote,
    ...(extraRoots.length > 0 ? { allowedRoots: [dirname(resolve(schemaPath)), ...extraRoots] } : {}),
    ...(config.allowedHosts ? { allowedHosts: [...config.allowedHosts] } : {}),
    ...(config.allowPrivateHosts ? { allowPrivateHosts: config.allowPrivateHosts } : {}),
  }
}

/**
 * Renders resolver failures into a single CLI error message. A confinement
 * refusal is rewritten to name `--allowed-roots`, because the raw library text
 * tells the user to set an option the CLI does not otherwise expose.
 */
const formatResolveErrors = (schemaPath: string, errors: readonly ResolveError[]): string => {
  const details = errors.map((error) => `  - ${withAllowedRootsHint(error.message)}`).join('\n')
  return `Failed to resolve $refs in ${schemaPath}:\n${details}`
}

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
