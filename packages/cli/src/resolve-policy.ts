import { dirname, resolve } from 'node:path'
import type { ResolveError } from '@amritk/resolve-refs'

import { withAllowedRootsHint } from './allowed-roots-hint'
import type { CliConfig } from './cli-config'

/**
 * Builds the `@amritk/resolve-refs` options from the CLI config, mirroring the
 * safety posture of `mjst lint`: remote (`http(s)`) `$ref`s are refused unless
 * opted into, a non-empty `allowedHosts` implies remote fetching, private/
 * loopback hosts stay blocked as an SSRF guard unless explicitly permitted, and
 * a local `$ref` may not leave the document's own directory unless
 * `allowedRoots` names somewhere else.
 *
 * `allowedRoots` is passed only when the user asked for it, and it *adds* to the
 * document's own directory rather than replacing it. The library option replaces
 * the default outright, which would make `--allowed-roots ../common` quietly
 * revoke the folder the document itself lives in — the one directory a user
 * would never think to list. Entries are resolved against the process cwd (both
 * from the flag and from a config file), matching how `schema` and `outDir` are
 * treated in `cli.ts`.
 *
 * Shared by every document loader (plain JSON Schema, AsyncAPI) so one flag set
 * means one policy.
 */
export const buildResolveOptions = (config: Partial<CliConfig>, documentPath: string) => {
  // A non-empty allow-list is itself an opt-in to remote fetching.
  const remote = (config.resolveRemote ?? false) || (config.allowedHosts?.length ?? 0) > 0
  const extraRoots = (config.allowedRoots ?? []).map((root) => resolve(root))
  return {
    remote,
    ...(extraRoots.length > 0 ? { allowedRoots: [dirname(resolve(documentPath)), ...extraRoots] } : {}),
    ...(config.allowedHosts ? { allowedHosts: [...config.allowedHosts] } : {}),
    ...(config.allowPrivateHosts ? { allowPrivateHosts: config.allowPrivateHosts } : {}),
  }
}

/**
 * Renders resolver failures into a single CLI error message. A confinement
 * refusal is rewritten to name `--allowed-roots`, because the raw library text
 * tells the user to set an option the CLI does not otherwise expose.
 */
export const formatResolveErrors = (documentPath: string, errors: readonly ResolveError[]): string => {
  const details = errors.map((error) => `  - ${withAllowedRootsHint(error.message)}`).join('\n')
  return `Failed to resolve $refs in ${documentPath}:\n${details}`
}
