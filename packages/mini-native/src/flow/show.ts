import { requireHost } from '../current-host'
import { type ChildFactory, renderChild } from '../render-child'
import { toFactory } from '../to-factory'
import { toGetter } from '../to-getter'
import type { HostElement, MaybeReactive } from '../types'

/**
 * Props for {@link Show}, parameterised by the type of the `when` value so the
 * function-child form can hand the branch a value with `null` and `undefined`
 * already removed. See {@link toFactory} for how the built-element and factory
 * forms differ.
 */
export type ShowProps<T = unknown> = {
  /** The condition. A getter or signal tracks; a plain value is evaluated once. */
  when: MaybeReactive<T>
  /**
   * Rendered while `when` is truthy. An already-built element is reused, so its
   * state survives; a factory is lazy and rebuilt on re-entry. The factory may
   * also take one argument — a getter for the narrowed value — so the branch can
   * read whatever satisfied `when` without repeating the signal and without the
   * nullish half of its type: `{(user) => <text>{() => user().name}</text>}`.
   */
  children: HostElement | ((value: () => NonNullable<T>) => HostElement)
  /** Rendered while `when` is falsy. Nothing renders when this is omitted. */
  fallback?: HostElement | (() => HostElement)
}

/**
 * Renders `children` when `when` is truthy and `fallback` otherwise, adding and
 * removing the subtree rather than just hiding it — so the branch that is not
 * showing has its bindings torn down and stops reacting entirely.
 *
 * Use the `show` prop instead when the element should stay alive and merely
 * become invisible; use this when the branch should genuinely go away.
 *
 * Truthiness drives the switch rather than a strict boolean, so `when={user}`
 * renders the child branch for any non-nullish user and the fallback for `null`.
 *
 * A function child receives the narrowed value as a GETTER rather than as the
 * raw value, and that is what keeps a truthy→truthy change cheap: the getter
 * updates reactively while the branch itself stays exactly where it is, so a
 * focused input inside it is not rebuilt out from under the user.
 *
 * The subtree lives inside a wrapper element from the host. On the web that
 * wrapper is laid out as though it were not there; on a native target it is an
 * ordinary container view, which is how native view trees are built anyway.
 */
export const Show = <T>(props: ShowProps<T>): HostElement => {
  const wrapper = requireHost().createFlowHost()
  const when = toGetter(props.when)
  const fallback = props.fallback === undefined ? null : toFactory(props.fallback)

  // The narrowed value, handed to the function-child form as a getter. It keeps
  // the last truthy value on purpose: reading it tracks `when`, but a read that
  // happens while `when` has just gone falsy returns the previous value instead
  // of the falsy one. Both the swap effect and the child depend on `when`, so
  // whichever runs first, `user().name` cannot blow up in the tick the branch is
  // being torn down.
  let lastTruthy: NonNullable<T> | undefined
  const value = (): NonNullable<T> => {
    const current = when()
    if (current) lastTruthy = current as NonNullable<T>
    return lastTruthy as NonNullable<T>
  }

  // Built once so the reference stays stable across ticks. `renderChild` swaps
  // only when the selected factory changes identity, so every truthy→truthy
  // change resolves to this same factory and leaves the branch untouched.
  const children = props.children
  const branch: ChildFactory = typeof children === 'function' ? () => children(value) : () => children

  renderChild(wrapper, () => (when() ? branch : fallback))
  return wrapper
}
