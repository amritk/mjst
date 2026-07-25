/**
 * @amritk/mini-native — a signals-based UI runtime that renders to a native view
 * tree, built on the same idea as `@amritk/mini`: real host nodes created once,
 * mutated forever by signals, with no virtual tree in between.
 *
 * That absence is what makes this port viable. The hard part of a React-style
 * native framework is the reconciler — diffing a virtual tree and committing
 * minimal mutations across a bridge. There is no reconciler here to port, so
 * targeting a platform means implementing one `Host` and nothing else.
 *
 * This barrel is a deliberate exception to the repository's prefer-subpaths
 * rule: a UI framework has a genuine curated public API, and callers should be
 * able to reach the whole runtime in one import. The renderers stay on their
 * own subpaths (`/hosts/dom`, `/hosts/lynx`, `/hosts/memory`) so an app only
 * pulls in the platform it actually targets.
 *
 * @example
 * ```tsx
 * import { mount, setHost, signal } from '@amritk/mini-native'
 * import { createDomHost, domRoot } from '@amritk/mini-native/hosts/dom'
 *
 * setHost(createDomHost())
 *
 * const Counter = () => {
 *   const count = signal(0)
 *   return (
 *     <view onTap={() => count(count() + 1)}>
 *       <text>{() => `tapped ${count()} times`}</text>
 *     </view>
 *   )
 * }
 *
 * mount(domRoot(document.body), Counter)
 * ```
 */

export { bindProp } from './bind/bind-prop'
export { bindShow } from './bind/bind-show'
export { bindText } from './bind/bind-text'
export { bindValue } from './bind/bind-value'
export { clearHost, requireHost, setHost } from './current-host'
export {
  ELEMENT_TAGS,
  type ElementProps,
  type ElementTag,
  type NativeEventHandler,
  type NativeEventMap,
} from './elements'
export type { Host, HostEventHandler } from './host'
export { list } from './list'
export { mount } from './mount'
export { onCleanup } from './on-cleanup'
export { type ChildFactory, renderChild } from './render-child'
export {
  batch,
  computed,
  effect,
  effectScope,
  type ReadonlySignal,
  type Signal,
  signal,
} from './signals'
export type {
  ClassValue,
  Component,
  ContainerChild,
  ContainerChildren,
  Dispose,
  HostElement,
  HostNode,
  HostText,
  MaybeReactive,
  MiniChild,
  MiniChildren,
  StyleValue,
} from './types'
export { untrack } from './untrack'
export { type WatchOptions, watch } from './watch'
