import { list } from '../list'
import { toGetter } from '../to-getter'
import type { HostElement, MaybeReactive } from '../types'
import { buildContainer, type ContainerProps } from './build-container'
import { defaultKey } from './default-key'

/** Props for {@link For}, parameterised by the item type. */
export type ForProps<T> = ContainerProps & {
  /** The collection. A getter or signal tracks; a plain array renders once. */
  each: MaybeReactive<readonly T[]>
  /**
   * Builds the element for one item. `index` is the position at the moment the
   * row is first created and does not update on later reorders, so treat it as
   * a creation-time hint rather than a reactive value.
   */
  children: (item: T, index: number) => HostElement
  /**
   * Derives the stable key deciding row identity across updates. Defaults to
   * {@link defaultKey}; supply one whenever the list can reorder, so rows follow
   * their data instead of their slot.
   */
  key?: (item: T, index: number) => string
}

/**
 * Keyed list rendering — the ergonomic wrapper over the `list` primitive.
 *
 * One node exists per key. Appending adds rows without touching existing ones,
 * a removed key disposes its row and everything the row set up, and a row that
 * moves is repositioned rather than rebuilt. This adds nothing to the core
 * beyond a default key and a container, so anything it cannot express can drop
 * down to `list` directly.
 *
 * Every item needs a stable identity for this to work, because a row is built
 * once from the item it was given and is never rebuilt for a new one. When the
 * collection holds primitives that can repeat, or when position genuinely IS
 * the identity, reach for `Index` instead — keying such a list by value hands
 * two rows the same key, which `list` reports and drops.
 */
export const For = <T>(props: ForProps<T>): HostElement => {
  const container = buildContainer(props)
  const each = toGetter(props.each)
  const keyOf = props.key ?? defaultKey
  // `list` supplies the real position, so neither `key` nor `children` has to
  // recover it with a linear scan that would also mis-key duplicate items.
  list(container, each, keyOf, props.children)
  return container
}
