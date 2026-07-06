import type { CliConfig } from './cli-config'

/**
 * Resolves the effective extension for relative import specifiers in the
 * generated output. An explicit `importExt` (flag or config file) always wins.
 * Otherwise the default is `'ts'` — the literal on-disk paths, loadable by
 * Bun, Node's type stripping, and tsc with `allowImportingTsExtensions` —
 * except under `build`, where tsc must compile the sources and can only emit
 * from `'js'` specifiers.
 */
export const resolveImportExt = (config: Partial<CliConfig>): 'js' | 'ts' =>
  config.importExt ?? (config.build ? 'js' : 'ts')
