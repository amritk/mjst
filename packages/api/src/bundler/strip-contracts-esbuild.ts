import { readFile } from 'node:fs/promises'

import { stripContractFields } from './strip-contract-fields'

/** The loaders esbuild may need for the sources this plugin rewrites. */
type EsbuildLoader = 'ts' | 'tsx' | 'js' | 'jsx'

/** What a transformed module hands back to esbuild's loader pipeline. */
type OnLoadResult = {
  readonly contents: string
  readonly loader: EsbuildLoader
}

/**
 * The structural slice of esbuild's `Plugin` this package needs, declared
 * locally so the plugin ships without depending on esbuild's types. The
 * object is assignable to `Plugin` wherever esbuild itself is installed.
 */
export type StripContractsEsbuildPlugin = {
  readonly name: string
  readonly setup: (build: {
    readonly onLoad: (
      options: { readonly filter: RegExp },
      callback: (args: { readonly path: string }) => Promise<OnLoadResult | undefined>,
    ) => void
  }) => void
}

/** Options for {@link stripContractsEsbuild}. */
export type StripContractsEsbuildOptions = {
  /**
   * File paths to leave untouched. The escape hatch for modules whose
   * contracts the app itself reads at runtime (client-side validation
   * against `contract.request` schemas) — those must keep their freight.
   */
  readonly exclude?: RegExp
}

/**
 * esbuild compiles onLoad filters as Go regexes, so this stays a plain
 * alternation instead of the JS-flavored pattern the Bun plugin uses.
 */
const SCANNABLE_PATH = /\.(ts|tsx|js|jsx|mjs|cjs)$/

const loaderFor = (path: string): EsbuildLoader => {
  if (path.endsWith('.tsx')) return 'tsx'
  if (path.endsWith('.jsx')) return 'jsx'
  if (path.endsWith('.ts')) return 'ts'
  return 'js'
}

/**
 * esbuild plugin that strips server/OpenAPI freight from `defineContract`
 * call sites (see `stripContractFields`). Add it only to browser builds — a
 * server bundle genuinely reads the schemas. Modules without a
 * `defineContract` call return undefined so esbuild's default loader handles
 * them untouched.
 *
 * @example
 * ```typescript
 * import { build } from 'esbuild'
 * import { stripContractsEsbuild } from '@amritk/api/bundler'
 *
 * await build({
 *   entryPoints: ['./src/client.ts'],
 *   bundle: true,
 *   plugins: [stripContractsEsbuild()],
 * })
 * ```
 */
export const stripContractsEsbuild = (options?: StripContractsEsbuildOptions): StripContractsEsbuildPlugin => ({
  name: 'amritk-api-strip-contracts',
  setup: (build) => {
    build.onLoad({ filter: SCANNABLE_PATH }, async (args) => {
      if (options?.exclude?.test(args.path) === true) return undefined
      const source = await readFile(args.path, 'utf-8')
      if (!source.includes('defineContract')) return undefined
      const stripped = stripContractFields(source)
      if (stripped === source) return undefined
      return { contents: stripped, loader: loaderFor(args.path) }
    })
  },
})
