import type { MaybeReactive } from './types'

/**
 * Normalises a static-or-reactive prop into a getter, so downstream code has
 * exactly one shape to handle instead of branching on the value everywhere.
 *
 * A signal already is a getter and passes through untouched, which is what
 * makes `when={isOpen}` track while `when={true}` stays a constant.
 */
export const toGetter = <T>(value: MaybeReactive<T>): (() => T) =>
  typeof value === 'function' ? (value as () => T) : () => value
