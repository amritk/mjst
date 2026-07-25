import { mount } from '../mount'

/**
 * The slice of Vite's `import.meta.hot` that {@link hotMount} uses, declared
 * structurally so this module needs no `vite` types at all — Vite's own
 * `ViteHotContext` satisfies it, and so does any bundler that exposes the same
 * accept/dispose pair. `undefined` is part of the contract because
 * `import.meta.hot` is replaced with `undefined` in a production build.
 */
export type HotContext = {
  /** Called with no arguments to make this module its own hot-update boundary. */
  readonly accept: (callback?: (module: unknown) => void) => void
  /** Registers the teardown that runs before the updated module executes. */
  readonly dispose: (callback: () => void) => void
}

/**
 * {@link mount}, wired to the bundler's hot-module runtime so editing a
 * component swaps the tree in place instead of reloading the page.
 *
 * Without this, a mini app has no hot-update boundary: Vite walks up from the
 * edited component looking for a module that accepts the update, finds none,
 * and falls back to a full page reload. `hotMount` makes the entry module that
 * boundary — it registers the mount's `dispose` as the module's teardown, which
 * the runtime calls *before* the updated entry executes. The old tree is removed
 * and every effect and `onCleanup` in it fires; the new one mounts into a clean
 * container.
 *
 * **Add `acceptHotUpdates()` from `@amritk/mini/vite` to your Vite config.** It
 * is not optional: Vite decides where an update stops by *reading the source*
 * for `import.meta.hot.accept(`, and the runtime `accept` this helper calls is
 * invisible to that scan. The plugin appends the literal call to the module that
 * mounts. Without it every edit still reloads the page — no worse than before,
 * but none of this does anything.
 *
 * `hot` is accepted before the mount runs on purpose: a component that throws
 * mid-render leaves no disposer behind, but the runtime still has an accept
 * callback for the module, so the fix arrives as a hot update rather than
 * silently doing nothing until you refresh.
 *
 * In a production build `import.meta.hot` is `undefined` and this is exactly
 * `mount` — the same call site works in both modes, no `if (import.meta.hot)`
 * at the entry point.
 *
 * Two things to know:
 *
 * - **Signal state resets on every reload.** Mini has no compiler and no
 *   component identity, so there is nothing to map an old component's signals
 *   onto in the new one — the honest behaviour is a clean remount. State that
 *   should survive edits belongs in a separate store module: unchanged modules
 *   keep their instance across an update, so only the components reload.
 * - **Do not call `hot.dispose()` yourself.** The runtime keeps one disposer
 *   per module, so a second registration replaces mini's and leaks the old
 *   tree. Extra teardown goes in an `onCleanup` inside the root component,
 *   where the mount scope already owns it.
 *
 * @example
 * ```tsx
 * // vite.config.ts
 * plugins: [acceptHotUpdates()]
 *
 * // main.tsx — the entry module. Keep it thin: it re-runs on every edit below
 * // it, so `App` (and the rest of the tree) lives in its own module.
 * import { hotMount } from '@amritk/mini/hot'
 *
 * hotMount(document.body, App, import.meta.hot)
 * ```
 */
export const hotMount = (container: Element, component: () => Node, hot: HotContext | undefined): (() => void) => {
  if (hot === undefined) return mount(container, component)

  hot.accept()
  const dispose = mount(container, component)
  hot.dispose(dispose)
  return dispose
}
