import { readFile } from 'node:fs/promises'

import { stripContractFields } from './strip-contract-fields'

/** What the transformed module hands back to Bun's loader pipeline. */
type OnLoadResult = {
  readonly contents: string
  readonly loader: 'ts' | 'tsx' | 'js' | 'jsx'
}

/**
 * The structural slice of `BunPlugin` this package needs, declared locally so
 * the plugin ships without depending on `bun-types`. The object is assignable
 * to `BunPlugin` wherever those types are installed.
 */
export type StripContractsBunPlugin = {
  readonly name: string
  readonly setup: (build: {
    readonly onLoad: (
      constraints: { readonly filter: RegExp },
      callback: (args: { readonly path: string }) => Promise<OnLoadResult | undefined>,
    ) => void
  }) => void
}

/** Options for {@link stripContractsBun}. */
export type StripContractsBunOptions = {
  /**
   * File paths to leave untouched. The escape hatch for modules whose
   * contracts the app itself reads at runtime (client-side validation
   * against `contract.request` schemas) — those must keep their freight.
   */
  readonly exclude?: RegExp
}

const SCANNABLE_PATH = /\.(?:[cm]?[jt]s|[jt]sx)$/

const loaderFor = (path: string): OnLoadResult['loader'] => {
  if (path.endsWith('.tsx')) return 'tsx'
  if (path.endsWith('.jsx')) return 'jsx'
  if (/\.[cm]?ts$/.test(path)) return 'ts'
  return 'js'
}

/**
 * Bun.build plugin that strips server/OpenAPI freight from `defineContract`
 * call sites (see `stripContractFields`). Add it only to browser builds — a
 * server bundle genuinely reads the schemas. Modules without a
 * `defineContract` call fall through to Bun's default loader untouched.
 *
 * @example
 * ```typescript
 * import { stripContractsBun } from '@amritk/api/bundler'
 *
 * await Bun.build({
 *   entrypoints: ['./src/client.ts'],
 *   target: 'browser',
 *   plugins: [stripContractsBun()],
 * })
 * ```
 */
export const stripContractsBun = (options?: StripContractsBunOptions): StripContractsBunPlugin => ({
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
