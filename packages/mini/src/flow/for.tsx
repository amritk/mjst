import { toGetter } from '../internal/to-getter'
import type { MaybeReactive } from '../jsx-runtime'
import { list } from '../list'
import { createHost } from './create-host'
import { defaultKey } from './default-key'

/** Props for {@link For}, parameterised by the item type `T`. */
export type ForProps<T> = {
  /** The collection. A getter (or signal) tracks; a plain array renders once. */
  each: MaybeReactive<readonly T[]>
  /**
   * Builds the node for one item. `index` is the item's position when its node
   * is first created — it does not update on later reorders, so treat it as a
   * creation-time hint, not a reactive value.
   */
  children: (item: T, index: number) => HTMLElement
  /**
   * Derives the stable key that decides node identity across updates. Defaults
   * to {@link defaultKey}; supply one whenever the list can reorder so nodes
   * follow their data instead of their slot.
   */
  key?: (item: T, index: number) => string
}

/**
 * Keyed list rendering — the ergonomic wrapper over the core `list` primitive.
 * One node exists per key; appended items add nodes without touching existing
 * ones, removed keys dispose their node and its scope, and reorders converge.
 *
 * This adds nothing to the core: it is `list` plus a default key and a
 * layout-neutral host, so the dashboards get a `<For>` while the widget keeps
 * calling `list` directly.
 */
export const For = <T,>(props: ForProps<T>): HTMLElement => {
  const host = createHost()
  const each = toGetter(props.each)
  const keyOf = props.key ?? defaultKey
  list(
    host,
    each,
    (item) => keyOf(item, each().indexOf(item)),
    (item) => props.children(item, each().indexOf(item)),
  )
  return host
}
