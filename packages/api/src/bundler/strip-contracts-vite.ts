import { stripContractFields } from './strip-contract-fields'

/**
 * The structural slice of Vite's `Plugin` this package needs. Declared
 * locally so the plugin ships without a dependency on Vite's types — the
 * object is assignable to `Plugin` wherever Vite itself is installed.
 */
export type StripContractsVitePlugin = {
  readonly name: string
  readonly enforce: 'pre'
  readonly apply: 'build'
  readonly transform: (
    code: string,
    id: string,
    options?: { readonly ssr?: boolean },
  ) => { readonly code: string; readonly map: null } | null
}

/** Module ids worth scanning — TS/JS sources, with any query suffix Vite adds. */
const SCANNABLE_ID = /\.(?:[cm]?[jt]s|[jt]sx)(?:\?|$)/

/**
 * Vite plugin that strips server/OpenAPI freight from `defineContract` call
 * sites in browser builds (see `stripContractFields` for exactly what goes).
 * Runs `pre` so it sees original TypeScript sources, only during `build`
 * (dev-server modules stay untouched for debuggability), and skips SSR
 * modules — the server side genuinely reads the schemas.
 *
 * @example
 * ```typescript
 * // vite.config.ts
 * import { stripContractsVite } from '@amritk/api/bundler'
 *
 * export default defineConfig({ plugins: [stripContractsVite()] })
 * ```
 */
export const stripContractsVite = (): StripContractsVitePlugin => ({
  name: 'amritk-api-strip-contracts',
  enforce: 'pre',
  apply: 'build',
  transform: (code, id, options) => {
    if (options?.ssr === true) return null
    if (!SCANNABLE_ID.test(id) || !code.includes('defineContract')) return null
    const stripped = stripContractFields(code)
    return stripped === code ? null : { code: stripped, map: null }
  },
})
