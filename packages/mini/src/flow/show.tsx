import { createHost } from '../internal/create-host'
import { renderChild } from '../internal/render-child'
import { toFactory } from '../internal/to-factory'
import { toGetter } from '../internal/to-getter'
import type { MaybeReactive } from '../jsx-runtime'

/**
 * Props for {@link Show}. `children` and `fallback` accept either a built node
 * or a factory — see {@link toFactory} for why the two forms differ (lazy,
 * rebuilt-on-entry vs. reused, state-preserving).
 */
export type ShowProps = {
  /** The condition. A getter (or signal) tracks; a plain value is evaluated once. */
  when: MaybeReactive<unknown>
  /** Shown while `when` is truthy. */
  children: Node | (() => Node)
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
 */
export const Show = (props: ShowProps): HTMLElement => {
  const host = createHost()
  const when = toGetter(props.when)
  const branch = toFactory(props.children)
  const fallback = props.fallback === undefined ? null : toFactory(props.fallback)
  renderChild(host, () => (when() ? branch : fallback))
  return host
}
