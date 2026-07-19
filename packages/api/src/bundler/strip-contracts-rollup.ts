import { isScannableId } from './is-scannable-id'
import { stripContractFields } from './strip-contract-fields'

/**
 * The structural slice of Rollup's `Plugin` this package needs, declared
 * locally so the plugin ships without depending on Rollup's types. The
 * object is assignable to `Plugin` wherever Rollup itself is installed.
 */
export type StripContractsRollupPlugin = {
  readonly name: string
  readonly transform: (code: string, id: string) => { readonly code: string; readonly map: null } | null
}

/** Options for {@link stripContractsRollup}. */
export type StripContractsRollupOptions = {
  /**
   * Module ids to leave untouched, matched against the full resolved id. The
   * escape hatch for modules whose contracts the app itself reads at runtime
   * (client-side validation against `contract.request` schemas, in-browser
   * OpenAPI rendering) — those must keep their freight.
   */
  readonly exclude?: RegExp
}

/**
 * Rollup plugin that strips server/OpenAPI freight from `defineContract`
 * call sites in browser builds (see `stripContractFields` for exactly what
 * goes). Add it only to browser builds — a server bundle genuinely reads the
 * schemas. Returns null for modules it leaves alone so Rollup keeps the
 * original code and maps.
 *
 * @example
 * ```typescript
 * // rollup.config.js
 * import { stripContractsRollup } from '@amritk/api/bundler'
 *
 * export default { plugins: [stripContractsRollup()] }
 * ```
 */
export const stripContractsRollup = (options?: StripContractsRollupOptions): StripContractsRollupPlugin => ({
  name: 'amritk-api-strip-contracts',
  transform: (code, id) => {
    if (!isScannableId(id) || !code.includes('defineContract')) return null
    if (options?.exclude?.test(id) === true) return null
    const stripped = stripContractFields(code)
    return stripped === code ? null : { code: stripped, map: null }
  },
})
