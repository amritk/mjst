import { signal as createSignal, endBatch, startBatch } from 'alien-signals'

/**
 * Re-export the reactivity primitives so the rest of the monorepo depends on
 * `@amritk/mini`, not on alien-signals directly — if we ever swap the
 * signal engine, only this package changes.
 *
 * A signal is a callable: `count()` reads, `count(1)` writes. Effects run
 * synchronously on write unless wrapped in `batch`.
 */
export { computed, effect, effectScope } from 'alien-signals'

/**
 * A writable signal: call with no argument to read, with one to write.
 *
 * The setter signature is listed FIRST, then the getter. This ordering is
 * load-bearing, not stylistic: TypeScript infers a type parameter against a
 * `() => T` position (as `watch` and `list` both take) from the LAST call
 * signature of the value passed in. With the getter last, `watch(count, cb)`
 * infers `T` from `count`'s return type; with it first, inference would land
 * on the setter and conclude `T = void`, forcing every call site to wrap the
 * signal in `() => count()`. Reordering the two signatures is what removes
 * that thunk boilerplate — overload *resolution* at a call site is unaffected
 * (TypeScript tries every signature), so `count()` and `count(1)` both still
 * work.
 */
export type Signal<T> = {
  (value: T): void
  (): T
}

/**
 * The read half of a signal. Exposing state as this type keeps the setter
 * private to the module that owns the signal.
 */
export type ReadonlySignal<T> = () => T

/**
 * Creates a writable signal. This is alien-signals' `signal` re-typed with
 * the `Signal<T>` shape above (setter-first) so generic inference through
 * `watch`/`list` works without thunk wrappers — see `Signal` for the full
 * reasoning. The runtime function is untouched; only its type changes.
 *
 * With no initial value the signal starts `undefined` and its type widens to
 * include it, matching alien-signals' own two overloads.
 */
export const signal = createSignal as {
  <T>(): Signal<T | undefined>
  <T>(initialValue: T): Signal<T>
}

/**
 * Groups several signal writes into one propagation pass, so effects that
 * depend on more than one of them run once instead of once per write.
 */
export const batch = (fn: () => void): void => {
  startBatch()
  try {
    fn()
  } finally {
    endBatch()
  }
}
