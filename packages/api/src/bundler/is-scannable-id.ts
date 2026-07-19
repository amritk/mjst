/** Module ids worth scanning — TS/JS sources, with any query suffix Vite adds. */
const SCANNABLE_ID = /\.(?:[cm]?[jt]s|[jt]sx)(?:\?|$)/

/**
 * Whether a module id is a TS/JS source the strip transform should look at.
 * Shared by the Vite and Rollup plugins so both skip virtual modules, CSS,
 * assets, and anything else that cannot contain a `defineContract` call.
 */
export const isScannableId = (id: string): boolean => SCANNABLE_ID.test(id)
