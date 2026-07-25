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
 *
 * The installed host is read when the flush RUNS, not when it is scheduled.
 * Closing over the host instead would strand a swap: install one host, render
 * (which queues a commit against it), install another in the same tick, and the
 * outgoing host would receive the commit while the incoming one — the only host
 * with anything on screen — never got flushed at all. Reading `current` late
 * means whoever is installed at the end of the tick is the one that commits,
 * which is the only answer that holds for a hot reload or a test swapping hosts
 * between cases. For the same reason `clearHost` leaves the queued flag alone:
 * the pending microtask is what clears it, so a host installed in between still
 * rides the commit that is already scheduled rather than quietly suppressing it.
 */
export const scheduleFlush = (): void => {
  if (flushQueued || !current?.flush) return
  flushQueued = true
  void Promise.resolve().then(() => {
    flushQueued = false
    current?.flush?.()
  })
}
