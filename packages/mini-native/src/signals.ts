import { signal as createSignal } from 'alien-signals'

/**
 * The reactivity primitives, re-exported so the rest of the codebase depends on
 * this package rather than on alien-signals directly. If the signal engine is
 * ever swapped, this is the only file that changes.
 *
 * None of this is platform-specific — reactivity is just functions and
 * subscriptions — which is why the whole layer ports to a native target
 * unchanged. Only the code that touches nodes needed a host abstraction.
 */
export { computed, effect, effectScope } from 'alien-signals'

/**
 * A writable signal: call with no argument to read, with one to write.
 *
 * The setter signature is listed first and the getter second, which is
 * load-bearing rather than stylistic. TypeScript infers a type parameter in a
 * `() => T` position from the LAST call signature of the value passed in, so
 * with the getter last a signal passed straight to `list` or `watch` infers the
 * value type correctly. With the getter first, inference would land on the
 * setter and conclude `T = void`, forcing every call site to wrap the signal in
 * a thunk. Overload resolution at a call site is unaffected, so both `count()`
 * and `count(1)` still work.
 */
export type Signal<T> = {
  (value: T): void
  (): T
}

/** The read half of a signal, for exposing state while keeping the setter private. */
export type ReadonlySignal<T> = () => T

/** Creates a writable signal holding `initial`. */
export const signal = <T>(initial: T): Signal<T> => createSignal(initial) as Signal<T>
