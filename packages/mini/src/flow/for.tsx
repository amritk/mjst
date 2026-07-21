import { createHost } from '../internal/create-host'
import { toGetter } from '../internal/to-getter'
import { type ClassValue, jsx, type MaybeReactive, type MiniElementProps, type StyleValue } from '../jsx-runtime'
import { list } from '../list'
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
  /**
   * Render the rows into a real element of this tag instead of the default
   * layout-neutral `display: contents` host. Reach for it when the container
   * itself must be styled or lay out its rows directly.
   *
   * The canonical case is a `divide-y`-style list: those separators come from a
   * `& > :not([hidden]) ~ :not([hidden])` rule whose `>` combinator only sees
   * the container's *direct* children. The default host is a `display: contents`
   * wrapper, so the rows sit one level too deep for that selector and the
   * separators land between hosts, not rows. `as="ul"` makes the rows direct
   * children of a real `<ul>`, so the borders fall between them:
   *
   * ```tsx
   * <For each={signups} as="ul" class="divide-y divide-gray-200">
   *   {(s) => <li>{s.email}</li>}
   * </For>
   * ```
   */
  as?: string
  /**
   * Class for the `as` host — the same string / array / toggle-map forms JSX's
   * `class` accepts, static or reactive. Ignored when `as` is not set (the
   * `display: contents` host is not meant to be styled).
   */
  class?: MaybeReactive<ClassValue>
  /**
   * Inline style for the `as` host — the same cssText / object forms JSX's
   * `style` accepts, static or reactive. Ignored when `as` is not set.
   */
  style?: MaybeReactive<StyleValue>
  /** Called with the host element once built — the escape hatch for wiring the container directly. */
  ref?: (element: HTMLElement) => void
}

/**
 * Builds the element `list` reconciles into. Without `as` it is the shared
 * `display: contents` host; with `as` it is a real element of that tag, built
 * through `jsx` so `class`/`style`/`ref` behave exactly as they do on any JSX
 * element (arrays, toggle-maps, reactive getters, style objects all included).
 */
const buildHost = <T,>(props: ForProps<T>): HTMLElement => {
  if (props.as === undefined) return createHost()
  const hostProps: Record<string, unknown> = {}
  if (props.class !== undefined) hostProps['class'] = props.class
  if (props.style !== undefined) hostProps['style'] = props.style
  if (props.ref !== undefined) hostProps['ref'] = props.ref
  return jsx(props.as, hostProps as MiniElementProps)
}

/**
 * Keyed list rendering — the ergonomic wrapper over the core `list` primitive.
 * One node exists per key; appended items add nodes without touching existing
 * ones, removed keys dispose their node and its scope, and reorders converge.
 *
 * This adds nothing to the core: it is `list` plus a default key and a
 * layout-neutral host, so the dashboards get a `<For>` while the widget keeps
 * calling `list` directly. Pass `as` (with `class`/`style`) when the list
 * container itself must be a real, styleable element — see {@link ForProps.as}.
 */
export const For = <T,>(props: ForProps<T>): HTMLElement => {
  const host = buildHost(props)
  const each = toGetter(props.each)
  const keyOf = props.key ?? defaultKey
  // `list` supplies the real position, so neither `key` nor `children` has to
  // recover it with an O(n) `indexOf` (which also mis-keys duplicate items).
  list(host, each, keyOf, props.children)
  return host
}
