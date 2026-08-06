/**
 * `@amritk/api/bundler` — the build-time contract strip, as a pure
 * source-to-source transform plus the module-id filter that decides what to
 * feed it. No bundler-specific plugin objects: every bundler worth targeting
 * exposes a per-module text hook, the wiring is a handful of lines against
 * that hook (the README has one for Vite, Rollup, esbuild, `Bun.build`, and
 * an rspack/webpack loader), and a package-side plugin per bundler is a
 * matrix that is permanently one entry behind whatever the ecosystem ships
 * next. This entry carries no `node:*` import at all, so it is safe to
 * import from a config file loaded in any runtime.
 */
export { isScannableId } from './is-scannable-id'
export { stripContractFields } from './strip-contract-fields'
