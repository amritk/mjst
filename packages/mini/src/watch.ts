import { effect, setActiveSub } from 'alien-signals'

/** Options for {@link watch}. */
export type WatchOptions = {
  /**
   * Run `callback` once on setup as well, with the initial value (and
   * `previous` as `undefined`). Defaults to `false` — the change-only behaviour.
   */
  immediate?: boolean
}

/**
 * Runs `callback` whenever the tracked value of `get` changes, like Vue's
 * `watch`: by default the first evaluation only records dependencies, and the
 * callback fires on subsequent changes with the new and previous values.
 *
 * Exists because a plain `effect` cannot express "react to changes but skip
 * the initial run" — side effects like attaching a window listener when an
 * overlay opens must not fire during setup. Pass `{ immediate: true }` when the
 * effect *should* also run for the current value; that first call receives
 * `previous` as `undefined`.
 *
 * Only `get` is tracked: the callback runs outside the tracking scope (like
 * Vue's `watch`), so a signal read *inside* the callback does not become a
 * dependency and cannot re-fire the watcher. This is what lets a callback read
 * or write other state — `watch(query, () => fetch(query(), { signal: abort() }))` —
 * without the watcher re-running when that unrelated state changes.
 *
 * Returns a stop function. Values are compared with `Object.is`, so getters
 * should return primitives or stable references.
 *
 * @example
 * ```ts
 * const query = signal('')
 * // Fires only on change, not on setup — pass the signal (a getter), don't call it:
 * const stop = watch(query, (next, previous) => {
 *   console.log(`search changed: ${previous} → ${next}`)
 * })
 * // Run for the current value too:
 * watch(query, (next) => fetchResults(next), { immediate: true })
 * ```
 */
export const watch = <T>(
  get: () => T,
  callback: (value: T, previous: T) => void,
  options?: WatchOptions,
): (() => void) => {
  const immediate = options?.immediate ?? false
  let first = true
  let previous: T
  return effect(() => {
    const value = get()
    if (first) {
      first = false
      previous = value
      // `previous` is genuinely absent on the immediate run; the parameter is
      // typed `T` for the common change-only case, so it arrives as `undefined`.
      if (immediate) runUntracked(() => callback(value, undefined as T))
      return
    }
    if (Object.is(value, previous)) return
    const old = previous
    previous = value
    runUntracked(() => callback(value, old))
  })
}

/**
 * Runs `fn` with dependency tracking suspended, so signals it reads are not
 * linked to the surrounding effect. `setActiveSub(undefined)` detaches the
 * active subscriber for the call and the previous one is restored in `finally`.
 */
const runUntracked = (fn: () => void): void => {
  const previous = setActiveSub(undefined)
  try {
    fn()
  } finally {
    setActiveSub(previous)
  }
}
