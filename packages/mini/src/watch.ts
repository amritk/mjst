import { effect } from 'alien-signals'

/**
 * Runs `callback` whenever the tracked value of `get` changes, like Vue's
 * `watch`: the first evaluation only records dependencies, and the callback
 * fires on subsequent changes with the new and previous values.
 *
 * Exists because a plain `effect` cannot express "react to changes but skip
 * the initial run" — side effects like attaching a window listener when an
 * overlay opens must not fire during setup.
 *
 * Returns a stop function. Values are compared with `Object.is`, so getters
 * should return primitives or stable references.
 */
export const watch = <T>(get: () => T, callback: (value: T, previous: T) => void): (() => void) => {
  let first = true
  let previous: T
  return effect(() => {
    const value = get()
    if (first) {
      first = false
      previous = value
      return
    }
    if (Object.is(value, previous)) return
    const old = previous
    previous = value
    callback(value, old)
  })
}
