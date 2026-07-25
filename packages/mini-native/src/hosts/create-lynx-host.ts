import type { Host, HostEventHandler } from '../host'
import type { HostElement, HostNode, HostText, StyleValue } from '../types'
import { globalLynxApi, type LynxElement, type LynxElementApi } from './lynx-element-api'

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
      api.__SetAttribute(element, name, value === false || value === undefined ? null : value)
    },

    getProperty: (target, name) => api.__GetAttributes(fromHostElement(target))[name],

    setStyle: (target, value) => {
      // Passing an empty bag is how a style is cleared: it replaces whatever
      // was set before, since `__SetInlineStyles` overwrites wholesale.
      api.__SetInlineStyles(fromHostElement(target), value === null ? {} : toStyleStrings(value))
    },

    // Lynx lays elements out with flex by default, so restoring visibility
    // means restoring `flex` rather than clearing the property.
    setVisible: (target, visible) =>
      api.__AddInlineStyle(fromHostElement(target), 'display', visible ? 'flex' : 'none'),

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

/**
 * Stringifies a style bag and drops the entries that mean "unset".
 *
 * Numbers are passed through as strings rather than given a unit, matching
 * every other host: the caller decides units, because guessing `px` would be
 * wrong for the many unitless properties.
 */
const toStyleStrings = (value: StyleValue): Record<string, string> => {
  const styles: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry === null || entry === undefined || entry === false) continue
    styles[key] = String(entry)
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
