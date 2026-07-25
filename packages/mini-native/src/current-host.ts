import type { Host } from './host'

/**
 * The installed renderer. There is exactly one per JavaScript context, set once
 * at startup before the first component runs.
 *
 * A module-level host rather than a renderer instance threaded through the tree
 * is a deliberate trade. TypeScript resolves the JSX factory from a module
 * (`jsxImportSource`), so `jsx` has to be a module-level export — it cannot be
 * a method on a renderer object without a compiler plugin to rewrite call
 * sites, and staying compilerless is the point of this runtime. One host per
 * context is also all any real app needs: you are rendering to a screen, and
 * there is one of those.
 */
let current: Host | null = null

/** Pending flush, coalescing every mutation in a tick into a single commit. */
let flushQueued = false

/**
 * Installs the renderer. Call this once, before mounting anything.
 *
 * @example
 * ```ts
 * import { setHost } from '@amritk/mini-native'
 * import { createDomHost } from '@amritk/mini-native/hosts/dom'
 *
 * setHost(createDomHost())
 * ```
 */
export const setHost = (host: Host): void => {
  current = host
}

/**
 * Returns the installed host, or throws if there is not one yet.
 *
 * A missing host is a boot-order mistake, not a recoverable condition — the
 * app cannot render anything at all without one — so this throws rather than
 * returning a `Result`. Every caller is deep inside rendering, where there is
 * no sensible way to carry a failure back out.
 */
export const requireHost = (): Host => {
  if (!current) {
    throw new Error('No host installed. Call setHost(...) before rendering.')
  }
  return current
}

/**
 * Clears the installed host. This exists for tests, which need each case to
 * start from a clean context rather than inheriting the previous one's tree.
 */
export const clearHost = (): void => {
  current = null
  flushQueued = false
}

/**
 * Asks the host to commit its pending mutations at the end of the current tick.
 *
 * Hosts that apply mutations eagerly (the DOM) have no `flush` and this does
 * nothing. Hosts that batch (Lynx, which needs its element tree flushed before
 * anything appears) get exactly one commit per tick no matter how many
 * attributes changed, which is the difference between a cheap update and a
 * whole-tree commit per signal write.
 *
 * The tick is scheduled on the promise job queue rather than `queueMicrotask`:
 * the latter is a host global every platform happens to provide but no
 * JavaScript engine is required to, and this file is compiled without any
 * platform library. `Promise.resolve().then` is the same microtask, spelled in
 * ECMAScript.
 */
export const scheduleFlush = (): void => {
  const host = current
  if (!host?.flush || flushQueued) return
  flushQueued = true
  void Promise.resolve().then(() => {
    flushQueued = false
    host.flush?.()
  })
}
