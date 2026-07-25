/**
 * `@amritk/mini/hot` — hot reloading for a mini app, in one call at the entry
 * point. `hotMount(container, App, import.meta.hot)` hands the bundler the
 * mount's `dispose`, so editing a component tears the old tree down and mounts
 * the new one instead of reloading the page. With `import.meta.hot` undefined
 * (a production build) it is plain `mount`, so the same line serves both.
 *
 * It is one half of a pair: `acceptHotUpdates()` from `@amritk/mini/vite` marks
 * the module that mounts as the hot-update boundary, which only a source
 * transform can do — Vite reads the module text for `import.meta.hot.accept(`
 * and never sees a runtime call made through a helper.
 *
 * It lives in a subpath rather than in `mount` itself because the `.` entry is
 * byte-budgeted for the embed widget, which ships one static bundle and has no
 * dev server to hot-update. The dashboards import this; the widget pays nothing.
 * There is no `vite` import here — the hot context is matched structurally.
 */
export type { HotContext } from './hot-mount'
export { hotMount } from './hot-mount'
