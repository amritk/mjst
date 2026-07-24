import { createHost } from '../internal/create-host'
import { type ChildFactory, renderChild } from '../internal/render-child'
import { toFactory } from '../internal/to-factory'
import { toGetter } from '../internal/to-getter'
import type { MaybeReactive } from '../jsx-runtime'

/**
 * Props for {@link Show}, parameterised by the `when` value type `T`.
 * `children` and `fallback` accept either a built node or a factory — see
 * {@link toFactory} for why the two forms differ (lazy, rebuilt-on-entry vs.
 * reused, state-preserving).
 */
export type ShowProps<T = unknown> = {
  /** The condition. A getter (or signal) tracks; a plain value is evaluated once. */
  when: MaybeReactive<T>
  /**
   * Shown while `when` is truthy. A node is reused (state-preserving); a
   * zero-arg factory is lazy and rebuilt on re-entry. The factory may also take
   * one argument — a getter for the narrowed value — so the branch can read the
   * value that satisfied `when` without repeating the signal and with `null`
   * / `undefined` already removed from its type: `{(user) => <b>{() => user().name}</b>}`.
   */
  children: Node | ((value: () => NonNullable<T>) => Node)
  /** Shown while `when` is falsy. Nothing renders when omitted. */
  fallback?: Node | (() => Node)
}

/**
 * Renders `children` when `when` is truthy and `fallback` otherwise — the
 * ergonomic conditional mini's core deliberately omits (its `show`/`bindShow`
 * only toggle visibility; this adds and removes the subtree, tearing down the
 * hidden branch's bindings).
 *
 * Truthiness, not strict `boolean`, drives the switch, so `when={user}` renders
 * the child branch for any non-nullish user and the fallback for `null`.
 *
 * A function child receives the narrowed value as a **getter** (`() => T` with
 * nullish removed), not the raw value, which is what keeps the P0 guarantee: a
 * truthy→truthy change updates the getter reactively without rebuilding the
 * branch, so a focused input inside it survives. The getter returns the last
 * truthy value, so a read that races the branch's teardown (both the swap and
 * the child depend on `when`) never sees the falsy value and cannot throw.
 */
export const Show = <T,>(props: ShowProps<T>): HTMLElement => {
  const host = createHost()
  const when = toGetter(props.when)
  const fallback = props.fallback === undefined ? null : toFactory(props.fallback)

  // The narrowed value, as a getter for the function-child form. It holds the
  // last truthy value: reading it tracks `when`, but a read during teardown
  // (when `when` has just gone falsy) returns the previous value rather than the
  // falsy one, so `user().name` cannot blow up in the frame the branch is being
  // removed — regardless of whether the child or the swap effect runs first.
  let lastTruthy: NonNullable<T> | undefined
  const value = (): NonNullable<T> => {
    const current = when()
    if (current) lastTruthy = current as NonNullable<T>
    return lastTruthy as NonNullable<T>
  }

  // Built once so the reference is stable — renderChild's identity check then
  // treats every truthy→truthy change as a no-op swap and keeps the node.
  const children = props.children
  const branch: ChildFactory = typeof children === 'function' ? () => children(value) : () => children

  renderChild(host, () => (when() ? branch : fallback))
  return host
}
