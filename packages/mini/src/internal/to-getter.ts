import type { MaybeReactive } from '../jsx-runtime'

/**
 * Normalises a static-or-reactive value into a plain getter, so a feature can
 * treat both forms with one code path.
 *
 * This is the same reactivity rule the JSX runtime applies: a function value is
 * assumed to be a live getter (a signal is a zero-argument function, so it
 * qualifies as-is) and is returned untouched; any other value is wrapped in a
 * getter that always returns it. Passing a signal without calling it therefore
 * stays reactive, and passing a concrete value stays static — exactly the
 * distinction the runtime makes for props.
 */
export const toGetter = <T>(value: MaybeReactive<T>): (() => T) =>
  (typeof value === 'function' ? value : () => value) as () => T
