import type { Host, HostEventHandler } from '../host'
import type { HostElement, HostNode, HostText, StyleValue } from '../types'
import { globalLynxApi, type LynxElement, type LynxElementApi } from './lynx-element-api'
import { toStyleText } from './to-style-text'

/**
 * A host that renders onto Lynx, driving its Element PAPI directly.
 *
 * Lynx is the natural target for this framework. Its element tree is MUTABLE
 * and imperative — create a node, set an attribute, append a child — which is
 * exactly the shape a runtime with no virtual tree needs. The PAPI exists in
 * the first place so that frameworks other than React can drive the engine, so
 * this adapter is using it as intended rather than working around anything.
 *
 * Contrast that with a renderer whose tree is immutable and rebuilt on every
 * change: there, each attribute write would turn into a whole-tree commit,
 * because there would be no way to mutate a node in place. That mismatch is the
 * single biggest thing to check before pointing this runtime at a new target.
 *
 * Nothing reaches the screen until the tree is flushed, so this host defines
 * `flush` and lets the scheduler coalesce a whole tick of mutations into one
 * commit.
 *
 * @param api The Element PAPI. Defaults to the engine globals; pass a fake to
 *   exercise the adapter off-device.
 */
export const createLynxHost = (api: LynxElementApi = globalLynxApi()): Host => {
  /**
   * Handlers registered per element and event name.
   *
   * Lynx keeps only one listener per event, so registering a second would
   * silently drop the first. Instead a single dispatcher is registered per name
   * and the real handlers are fanned out from here, which restores the
   * add-many semantics every other host provides.
   */
  const handlers = new WeakMap<LynxElement, Map<string, Set<HostEventHandler>>>()

  /**
   * What the host remembers about an element's visibility.
   *
   * Lynx expresses both a style bag and visibility through inline styles, and
   * `__SetInlineStyles` overwrites wholesale, so a style write would otherwise
   * un-hide an element the runtime had hidden. Remembering the two separately
   * lets a style write re-assert the hidden state, and lets showing an element
   * again restore the display its own style asked for.
   */
  const visibility = new WeakMap<LynxElement, LynxVisibility>()

  const visibilityOf = (element: LynxElement): LynxVisibility => {
    const existing = visibility.get(element)
    if (existing) return existing
    const created: LynxVisibility = { styleDisplay: null, hidden: false }
    visibility.set(element, created)
    return created
  }

  return {
    // A framework-owned tree does not participate in Lynx's own component
    // system, so every element is created under component ID 0.
    createElement: (tag) => toHostElement(api.__CreateElement(tag, 0, {})),

    // A native container view is the idiomatic wrapper for a swapped subtree,
    // so unlike the web there is no layout trick needed here — the wrapper is
    // simply part of the view hierarchy, which is how native trees are built.
    createFlowHost: () => toHostElement(api.__CreateElement('view', 0, {})),

    // Text in Lynx lives in a `raw-text` element carrying a `text` attribute,
    // nested inside a `<text>` element that provides the styling.
    createText: (value) => {
      const node = api.__CreateElement('raw-text', 0, {})
      api.__SetAttribute(node, 'text', value)
      return toHostText(node)
    },

    setText: (node, value) => api.__SetAttribute(fromHostText(node), 'text', value),

    setProperty: (target, name, value) => {
      const element = fromHostElement(target)
      // Classes have their own PAPI call and are not attributes, so `class`
      // has to be routed rather than passed through.
      if (name === 'class') {
        api.__SetClasses(element, typeof value === 'string' ? value : '')
        return
      }
      api.__SetAttribute(element, ATTRIBUTES[name] ?? name, value === false || value === undefined ? null : value)
    },

    getProperty: (target, name) => api.__GetAttributes(fromHostElement(target))[ATTRIBUTES[name] ?? name],

    setStyle: (target, value) => {
      const element = fromHostElement(target)
      const state = visibilityOf(element)
      // Passing an empty bag is how a style is cleared: it replaces whatever
      // was set before, since `__SetInlineStyles` overwrites wholesale.
      const styles = value === null ? {} : toStyleStrings(value)
      state.styleDisplay = styles['display'] ?? null
      api.__SetInlineStyles(element, styles)
      // That wholesale replacement is exactly what would un-hide a hidden
      // element, so the runtime's visibility is put back on top of it.
      if (state.hidden) api.__AddInlineStyle(element, 'display', 'none')
    },

    setVisible: (target, visible) => {
      const element = fromHostElement(target)
      const state = visibilityOf(element)
      state.hidden = !visible
      // Showing an element restores what its own style bag asked for. Lynx lays
      // elements out with flex by default, so a bag that said nothing about
      // display gets `flex` back rather than the property being cleared.
      api.__AddInlineStyle(element, 'display', visible ? (state.styleDisplay ?? DEFAULT_DISPLAY) : 'none')
    },

    addEventListener: (target, name, handler) => {
      const element = fromHostElement(target)
      const byName = handlers.get(element) ?? new Map<string, Set<HostEventHandler>>()
      handlers.set(element, byName)

      const existing = byName.get(name)
      if (existing) {
        existing.add(handler)
      } else {
        const set = new Set<HostEventHandler>([handler])
        byName.set(name, set)
        // Iterate a copy so a handler detaching itself cannot disturb the walk.
        api.__AddEvent(element, 'bindEvent', name, (event) => {
          for (const listener of [...set]) listener(event)
        })
      }

      return () => {
        const set = byName.get(name)
        if (!set) return
        set.delete(handler)
        // Drop the dispatcher once nothing is listening, so the engine is not
        // left calling into an empty set for every gesture.
        if (set.size === 0) {
          byName.delete(name)
          api.__AddEvent(element, 'bindEvent', name, null)
        }
      }
    },

    insert: (parent, node, anchor) => {
      const parentElement = fromHostElement(parent)
      const child = fromHostNode(node)
      // Detach first so an insert doubles as a move, which is what the list
      // reconciler relies on when rows change position.
      const currentParent = api.__GetParent(child)
      if (currentParent) api.__RemoveElement(currentParent, child)

      if (anchor === null) api.__AppendElement(parentElement, child)
      else api.__InsertElementBefore(parentElement, child, fromHostNode(anchor))
    },

    remove: (node) => {
      const child = fromHostNode(node)
      const parent = api.__GetParent(child)
      if (parent) api.__RemoveElement(parent, child)
    },

    clear: (target) => {
      const element = fromHostElement(target)
      for (const child of api.__GetChildren(element)) api.__RemoveElement(element, child)
    },

    firstChild: (target) => {
      const first = api.__FirstElement(fromHostElement(target))
      return first === null ? null : toHostNode(first)
    },

    nextSibling: (node) => {
      const next = api.__NextElement(fromHostNode(node))
      return next === null ? null : toHostNode(next)
    },

    flush: () => api.__FlushElementTree(),
  }
}

/**
 * Wraps an element the engine already owns — typically the page — as a mount
 * target, so an app can attach to it without the runtime seeing a Lynx type.
 */
export const lynxRoot = (element: LynxElement): HostElement => toHostElement(element)

/** What the host remembers per element so a style write cannot disturb visibility. */
type LynxVisibility = {
  /** The `display` the element's own style bag asked for, or `null` when it asked for none. */
  styleDisplay: string | null
  /** Whether the runtime has hidden this element through `setVisible`. */
  hidden: boolean
}

/** What an element lays out as when nothing has said otherwise. Lynx is flex everywhere. */
const DEFAULT_DISPLAY = 'flex'

/**
 * Vocabulary prop names Lynx spells differently.
 *
 * `testId` is the interesting one: passed through raw it is an attribute the
 * engine does not recognise, so a UI test would have nothing to select on. The
 * DOM host already emits `data-testid`, and matching it here means one selector
 * finds the element in the browser preview and on the device alike.
 */
const ATTRIBUTES: Record<string, string> = {
  testId: 'data-testid',
}

/**
 * Stringifies a style bag and drops the entries that mean "unset".
 *
 * Numbers become density-independent pixels here rather than being handed over
 * bare, which is the host's job per the contract — see {@link toStyleText} for
 * the properties that stay unitless.
 */
const toStyleStrings = (value: StyleValue): Record<string, string> => {
  const styles: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry === null || entry === undefined || entry === false) continue
    styles[key] = toStyleText(key, entry)
  }
  return styles
}

/*
 * Host nodes are opaque to the runtime, so the adapter crosses that boundary
 * with a cast. Confining the casts here keeps everything above typed against
 * the real Lynx element type.
 */
const toHostElement = (node: LynxElement): HostElement => node as unknown as HostElement
const toHostText = (node: LynxElement): HostText => node as unknown as HostText
const toHostNode = (node: LynxElement): HostNode => node as unknown as HostNode
const fromHostElement = (node: HostElement): LynxElement => node as unknown as LynxElement
const fromHostText = (node: HostText): LynxElement => node as unknown as LynxElement
const fromHostNode = (node: HostNode): LynxElement => node as unknown as LynxElement
