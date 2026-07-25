import type { Dispose, HostElement, HostNode, HostText, StyleValue } from './types'

/**
 * The renderer contract — the entire platform surface this framework needs.
 *
 * Everything else in the package is written against these functions and never
 * touches a platform API directly. Porting to a new target (a native view
 * tree, a canvas, a terminal) means writing one of these and nothing else.
 *
 * The contract is small because the framework has no virtual DOM and no
 * reconciler: JSX builds a host node once and signals mutate it in place
 * forever. There is no tree to diff, so there is no commit protocol here —
 * only direct, imperative mutation. That is also the one hard requirement a
 * target must satisfy: its node tree has to be MUTABLE. A target whose tree is
 * immutable (rebuilt and committed on every change) is a poor fit, because
 * every attribute write would become a whole-tree commit.
 */
export type Host = {
  /**
   * Creates an element for one of the tags in the element vocabulary. Hosts map
   * the vocabulary onto whatever they actually render — the DOM host turns
   * `view` into a `<div>`, a native host turns it into a real container view.
   */
  createElement: (tag: string) => HostElement

  /**
   * Creates the wrapper element the control-flow components swap their children
   * inside. It exists as a separate method because the right wrapper differs
   * per target: the DOM host returns a `display: contents` div so the wrapper
   * vanishes from layout, while a native host returns an ordinary container
   * view, which is idiomatic there anyway.
   */
  createFlowHost: () => HostElement

  createText: (value: string) => HostText

  setText: (node: HostText, value: string) => void

  /**
   * Applies one attribute or property. `false`, `null`, and `undefined` mean
   * "unset it"; everything else is the value. The runtime resolves `class`
   * arrays and objects to a plain string before calling this, so hosts only
   * ever see primitives.
   */
  setProperty: (element: HostElement, name: string, value: unknown) => void

  /**
   * Reads a property back. Only the two-way input bindings need this, to pull
   * the current text or checked state out of a control after the user has
   * changed it.
   */
  getProperty: (element: HostElement, name: string) => unknown

  /** Applies a style bag. A `null` clears any style previously applied. */
  setStyle: (element: HostElement, value: StyleValue | null) => void

  /**
   * Shows or hides an element without removing it from the tree. Kept separate
   * from `setStyle` because targets disagree on how visibility works — inline
   * `display` on the web, a dedicated flag or style key natively.
   */
  setVisible: (element: HostElement, visible: boolean) => void

  /**
   * Attaches an event listener and returns a dispose that detaches it. Names
   * arrive lowercased and undecorated (`click`, `input`, `focus`); mapping them
   * onto the target's own event system is the host's job.
   *
   * There is no delegation and there are no listener options, which keeps this
   * portable — native targets have no bubbling phase to hook into.
   */
  addEventListener: (element: HostElement, name: string, handler: HostEventHandler) => Dispose

  /**
   * Inserts `node` into `parent` before `anchor`, or appends it when `anchor`
   * is `null`. This single method covers both appending and reordering, which
   * is all the keyed list reconciler needs.
   */
  insert: (parent: HostElement, node: HostNode, anchor: HostNode | null) => void

  /** Detaches a node from its parent. */
  remove: (node: HostNode) => void

  /** Detaches every child of an element. */
  clear: (element: HostElement) => void

  firstChild: (element: HostElement) => HostNode | null

  nextSibling: (node: HostNode) => HostNode | null

  /**
   * Commits pending mutations, for targets that batch rather than apply
   * immediately (Lynx, for instance, needs its element tree flushed). Hosts
   * that apply mutations eagerly leave this out and the scheduler skips it.
   *
   * The runtime never calls this synchronously per mutation — it coalesces
   * every change in a tick into a single flush, so a burst of signal writes
   * costs one commit rather than one per attribute.
   */
  flush?: () => void
}

/**
 * An event as the host delivers it. The runtime never reads an event, it only
 * forwards it to the handler the caller supplied, so this stays `unknown` —
 * each host's own typings narrow it at the call site.
 */
export type HostEventHandler = (event: unknown) => void
