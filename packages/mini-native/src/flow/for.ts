import { applyProp } from '../apply-prop'
import { requireHost } from '../current-host'
import type { ElementTag } from '../elements'
import { list } from '../list'
import { toGetter } from '../to-getter'
import type { ClassValue, HostElement, MaybeReactive, StyleValue } from '../types'
import { defaultKey } from './default-key'

/** Props for {@link For}, parameterised by the item type. */
export type ForProps<T> = {
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
  /**
   * Render rows into a real element of this tag instead of the default flow
   * wrapper. Reach for it when the container itself needs to be styled or to
   * lay its rows out directly — a `scroll-view` of rows being the common case.
   */
  as?: ElementTag
  /** Class for the `as` container. Ignored when `as` is not set. */
  class?: MaybeReactive<ClassValue>
  /** Style for the `as` container. Ignored when `as` is not set. */
  style?: MaybeReactive<StyleValue | null>
  /** Called with the container once built — the escape hatch for wiring it directly. */
  ref?: (element: HostElement) => void
}

/**
 * Keyed list rendering — the ergonomic wrapper over the `list` primitive.
 *
 * One node exists per key. Appending adds rows without touching existing ones,
 * a removed key disposes its row and everything the row set up, and reorders
 * converge. This adds nothing to the core beyond a default key and a container,
 * so anything it cannot express can drop down to `list` directly.
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

/**
 * Builds the element rows are reconciled into: the shared flow wrapper by
 * default, or a real element of the requested tag with `class`, `style`, and
 * `ref` applied exactly as they would be on any other element.
 */
const buildContainer = <T>(props: ForProps<T>): HostElement => {
  const host = requireHost()
  if (props.as === undefined) return host.createFlowHost()

  const container = host.createElement(props.as)
  if (props.class !== undefined) applyProp(container, 'class', props.class)
  if (props.style !== undefined) applyProp(container, 'style', props.style)
  props.ref?.(container)
  return container
}
