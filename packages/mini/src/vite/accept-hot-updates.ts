import type { Plugin } from 'vite'

/**
 * A first-party source module we may inject into — not a virtual module, not a
 * dependency, and not an asset that merely happens to pass through `transform`.
 */
const isInjectable = (id: string): boolean => {
  const path = id.split('?', 1)[0] ?? id
  return /\.[cm]?[jt]sx?$/.test(path) && !path.includes('/node_modules/')
}

/** A call to `hotMount` — the module that owns the app's mount, and so its hot boundary. */
const CALLS_HOT_MOUNT = /\bhotMount\s*\(/

/** An `import.meta.hot.accept` the author already wrote (optional chaining included). */
const ALREADY_ACCEPTS = /import\.meta\.hot\s*\??\.\s*accept/

/** Appended, not inserted, so every existing line keeps its position and the sourcemap stays honest. */
const ACCEPT = '\nimport.meta.hot?.accept()\n'

/**
 * A Vite plugin that makes the module calling `hotMount` (from
 * `@amritk/mini/hot`) its own hot-update boundary, by appending
 * `import.meta.hot?.accept()` to it.
 *
 * The injection is not a convenience — it is the only way this can work. Vite
 * decides where an update stops by **reading the source**: its import analysis
 * looks for the literal text `import.meta.hot.accept(` in a module and only then
 * marks it self-accepting on the server. A runtime `hot.accept()` call reached
 * through a helper is invisible to that scan, so without this plugin the server
 * walks up from the edited component, finds no boundary, and sends a full page
 * reload — which is exactly the thing hot reloading is meant to replace.
 *
 * Only modules that call `hotMount` are touched, one line is appended to the
 * end (so no existing line moves), and a module that already accepts on its own
 * is left alone. It applies during `vite serve` only: `vite build` has no hot
 * runtime, and the call must never reach a production bundle.
 *
 * @example
 * ```ts
 * import { defineConfig } from 'vite'
 *
 * import { acceptHotUpdates, catchCalledSignals } from '@amritk/mini/vite'
 *
 * export default defineConfig({
 *   plugins: [catchCalledSignals(), acceptHotUpdates()],
 * })
 * ```
 */
export const acceptHotUpdates = (): Plugin => ({
  name: '@amritk/mini:accept-hot-updates',
  apply: 'serve',
  transform(code, id) {
    if (id.startsWith('\0') || !isInjectable(id)) return null
    if (!CALLS_HOT_MOUNT.test(code) || ALREADY_ACCEPTS.test(code)) return null

    return { code: `${code}${ACCEPT}`, map: null }
  },
})
