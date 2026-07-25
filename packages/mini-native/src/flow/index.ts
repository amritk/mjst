/**
 * The control-flow components — the ergonomic layer over `renderChild` and
 * `list`, grouped behind one subpath because they are a coherent set rather
 * than a grab bag of independent utilities.
 *
 * Each renders its subtree inside a wrapper element the host supplies. On the
 * web that wrapper is laid out as though it were not there; on a native target
 * it is an ordinary container view, which is how those trees are built anyway,
 * so the wrapper costs nothing there and often reads better.
 *
 * `Show` and `Switch` are the two-way and multi-way conditionals and `Dynamic`
 * is the general subtree swap underneath both. `For` and `Index` are the two
 * collection components, differing only in what identifies a row: `For` keys on
 * the item and is the right default, `Index` keys on the position and is the
 * answer for collections whose values can repeat. `defaultKey` is exported
 * alongside them so a caller can reuse the default keying policy rather than
 * reimplement it.
 */

export { defaultKey } from './default-key'
export { Dynamic, type DynamicProps } from './dynamic'
export { For, type ForProps } from './for'
export { Index, type IndexProps } from './index-rows'
export { Match, type MatchProps } from './match'
export { Show, type ShowProps } from './show'
export { Switch, type SwitchProps } from './switch'
