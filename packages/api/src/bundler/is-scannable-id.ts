/** Module ids worth scanning — TS/JS sources, with any query suffix Vite adds. */
const SCANNABLE_ID = /\.(?:[cm]?[jt]s|[jt]sx)(?:\?|$)/

/**
 * Whether a module id is a TS/JS source the strip transform should look at —
 * the guard to put in front of {@link stripContractFields} in a bundler hook
 * that sees every module, so virtual modules, CSS, assets, and anything else
 * that cannot contain a `defineContract` call are skipped. Tolerates the
 * `?query` suffixes Vite appends; hooks that filter by file path (esbuild and
 * `Bun.build` take a `filter` regex) can use their own pattern instead.
 */
export const isScannableId = (id: string): boolean => SCANNABLE_ID.test(id)
