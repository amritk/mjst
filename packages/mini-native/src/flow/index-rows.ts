import { list } from '../list'
import { type Signal, signal } from '../signals'
import { toGetter } from '../to-getter'
import type { HostElement, MaybeReactive } from '../types'
import { buildContainer, type ContainerProps } from './build-container'

/** Props for {@link Index}, parameterised by the item type. */
export type IndexProps<T> = ContainerProps & {
  /** The collection. A getter or signal tracks; a plain array renders once. */
  each: MaybeReactive<readonly T[]>
  /**
   * Builds the row that lives at one position. `item` is a GETTER, not a value,
   * and that is the whole point of this component — read it inside a binding and
   * the row follows whatever moves into its slot without being rebuilt.
   */
  children: (item: () => T, index: number) => HostElement
}

/**
 * Position-keyed list rendering: one row per SLOT rather than one row per item.
 *
 * `For` is the right default and this is the answer for the lists it cannot key
 * honestly — a collection of primitives that can legitimately repeat
 * (`['red', 'red', 'blue']`), where asking the values to be identities hands two
 * rows the same key. Here the position is the identity, so the third row is a
 * genuinely different row from the first even though the values match.
 *
 * The reason this needs to be a component rather than just a key function is
 * the part that is easy to get wrong. A row is built once and never rebuilt, so
 * if position were merely used as a key, inserting an item at the front would
 * leave every later slot holding the node built for whatever used to sit there
 * — still displaying that item's data. The list would silently render the wrong
 * values, which is worse than the duplicate-key warning it was working around.
 * Handing each row a getter for its slot instead is what closes that hole: the
 * node stays, and the bindings inside it re-read and update in place.
 *
 * The trade-off that remains is inherent to slot identity: a row does not
 * travel with its data, so anything living inside a row — focus, a scroll
 * position, a half-typed input — belongs to the position, not to the item that
 * happens to be there. When that matters, give the items real identities and
 * use `For`.
 *
 * @example
 * ```tsx
 * <Index each={tags}>{(tag) => <text>{() => tag()}</text>}</Index>
 * ```
 */
export const Index = <T>(props: IndexProps<T>): HostElement => {
  const container = buildContainer(props)
  const each = toGetter(props.each)
  // One signal per slot, holding whatever item currently occupies it. Rows read
  // their own slot's signal, so a row survives its item being replaced.
  const slots: Signal<T>[] = []

  /**
   * The slot numbers to render, refreshing each slot's item on the way past.
   *
   * The writes happen here, inside the getter `list` tracks, so that every slot
   * is already carrying its new item by the time a row is built or reconciled.
   * `list` only ever sees a list of positions, which is exactly the identity
   * this component claims.
   */
  const positions = (): readonly number[] => {
    const items = each()
    for (let at = 0; at < items.length; at++) {
      const item = items[at] as T
      const slot = slots[at]
      if (slot) slot(item)
      else slots[at] = signal(item)
    }
    // Slots past the end belong to rows `list` is about to dispose. Dropping
    // them keeps the array from growing to the high-water mark of every list
    // this component has ever rendered.
    slots.length = items.length
    return items.map((_, at) => at)
  }

  list(
    container,
    positions,
    (at) => String(at),
    (at) => props.children(() => (slots[at] as Signal<T>)(), at),
  )

  return container
}
