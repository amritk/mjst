import { requireHost } from '../current-host'
import { renderChild } from '../render-child'
import { toGetter } from '../to-getter'
import type { HostElement, MaybeReactive } from '../types'

/** Props for {@link Dynamic}. */
export type DynamicProps = {
  /**
   * Builds the subtree to show right now, or returns `null` for nothing. A
   * getter tracks, so returning a different builder swaps the whole subtree.
   */
  children: MaybeReactive<(() => HostElement) | null>
}

/**
 * Swaps an entire subtree reactively — the general case that `Show` is the
 * two-branch shortcut for.
 *
 * Whenever the selected builder changes, the previous subtree is disposed (its
 * effects stopped, its `onCleanup` callbacks run) before the next one is built.
 * That makes this the right primitive for routed screens and tab bodies, where
 * the branch leaving the tree must not keep reacting in the background.
 *
 * @example
 * ```tsx
 * <Dynamic>{() => SCREENS[route()] ?? null}</Dynamic>
 * ```
 */
export const Dynamic = (props: DynamicProps): HostElement => {
  const wrapper = requireHost().createFlowHost()
  const select = toGetter(props.children)
  renderChild(wrapper, select)
  return wrapper
}
