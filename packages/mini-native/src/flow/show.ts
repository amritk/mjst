import { requireHost } from '../current-host'
import { renderChild } from '../render-child'
import { toFactory } from '../to-factory'
import { toGetter } from '../to-getter'
import type { HostElement, MaybeReactive } from '../types'

/** Props for {@link Show}. */
export type ShowProps = {
  /** The condition. A getter or signal tracks; a plain value is evaluated once. */
  when: MaybeReactive<unknown>
  /** Rendered while `when` is truthy. See {@link toFactory} for how the two forms differ. */
  children: HostElement | (() => HostElement)
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
 * The subtree lives inside a wrapper element from the host. On the web that
 * wrapper is laid out as though it were not there; on a native target it is an
 * ordinary container view, which is how native view trees are built anyway.
 */
export const Show = (props: ShowProps): HostElement => {
  const wrapper = requireHost().createFlowHost()
  const when = toGetter(props.when)
  const branch = toFactory(props.children)
  const fallback = props.fallback === undefined ? null : toFactory(props.fallback)
  renderChild(wrapper, () => (when() ? branch : fallback))
  return wrapper
}
