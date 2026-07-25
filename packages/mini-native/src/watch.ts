import { effect } from 'alien-signals'

import type { Dispose } from './types'
import { untrack } from './untrack'

/** Options for {@link watch}. */
export type WatchOptions = {
  /**
   * Run `callback` once during setup too, with the initial value and
   * `previous` as `undefined`. Defaults to `false` — the change-only behaviour.
   */
  immediate?: boolean
}

/**
 * Runs `callback` whenever the tracked value of `get` changes, the way Vue's
 * `watch` does: the first evaluation only records dependencies, and the
 * callback fires on subsequent changes with the new and previous values.
 *
 * This exists because a plain `effect` cannot express "react to changes but
 * skip the initial run", and that distinction is unavoidable in a real app.
 * Pushing a screen when a route changes, raising the keyboard when a field
 * becomes active, firing a request when a query is edited — every one of them
 * is wrong if it also happens once during setup, and on a native target the
 * wrongness is visible: a screen pushed before the app has finished mounting.
 * Pass `{ immediate: true }` when the effect genuinely should run for the
 * current value as well.
 *
 * Only `get` is tracked. The callback runs untracked, so a signal read inside
 * it does not become a dependency and cannot re-fire the watcher — which is
 * what lets a callback freely read or write other state without turning itself
 * into a loop.
 *
 * Values are compared with `Object.is`, so `get` should return a primitive or a
 * stable reference. Returns a stop function.
 *
 * @example
 * ```ts
 * const route = signal('/home')
 * // Fires only on change — pass the signal (a getter), do not call it.
 * const stop = watch(route, (next, previous) => navigator.push(next, previous))
 * // Run for the current value too:
 * watch(route, (next) => track(next), { immediate: true })
 * ```
 */
export const watch = <T>(get: () => T, callback: (value: T, previous: T) => void, options?: WatchOptions): Dispose => {
  const immediate = options?.immediate ?? false
  let first = true
  let previous: T

  return effect(() => {
    const value = get()
    if (first) {
      first = false
      previous = value
      // `previous` is genuinely absent on the immediate run. The parameter is
      // typed `T` for the common change-only case, so it arrives as `undefined`.
      if (immediate) untrack(() => callback(value, undefined as T))
      return
    }
    if (Object.is(value, previous)) return
    const old = previous
    previous = value
    untrack(() => callback(value, old))
  })
}
