import type { Host, HostEventHandler } from '../host'
import type { HostElement, HostNode, HostText, StyleValue } from '../types'

/** An element in the in-memory tree. */
export type MemoryElement = {
  readonly kind: 'element'
  readonly tag: string
  readonly props: Record<string, unknown>
  readonly listeners: Map<string, Set<HostEventHandler>>
  readonly children: MemoryNode[]
  style: StyleValue | null
  visible: boolean
  parent: MemoryElement | null
}

/** A text node in the in-memory tree. */
export type MemoryText = {
  readonly kind: 'text'
  value: string
  parent: MemoryElement | null
}

export type MemoryNode = MemoryElement | MemoryText

/** What {@link createMemoryHost} hands back: the host plus a way to reach the tree it builds. */
export type MemoryHost = {
  host: Host
  /** The tree root. Mount into this and inspect it afterwards. */
  root: MemoryElement
  /** The root typed for the runtime, so it can be passed straight to `mount`. */
  rootElement: HostElement
}

/**
 * A headless host that renders into plain JavaScript objects.
 *
 * This is the reference implementation of the {@link Host} contract — it is the
 * shortest complete example of what a new target has to provide, and it is
 * small enough to read in one sitting before writing a real one.
 *
 * It also earns its place in the test suite twice over. It makes assertions
 * about structure trivial, and because it involves no platform at all, a test
 * that renders through it PROVES the runtime is free of any DOM dependency:
 * these tests run under Bun, where `document` genuinely does not exist, so a
 * stray platform call could not possibly pass unnoticed.
 */
export const createMemoryHost = (): MemoryHost => {
  const root = element('root')

  const host: Host = {
    createElement: (tag) => toHostElement(element(tag)),

    // Nothing in an object tree needs a layout escape hatch, so the flow
    // wrapper is just an ordinary element — the same choice a native host
    // makes, where a container view is the idiomatic wrapper anyway.
    createFlowHost: () => toHostElement(element('flow')),

    createText: (value) => toHostText({ kind: 'text', value, parent: null }),

    setText: (node, value) => {
      fromHostText(node).value = value
    },

    setProperty: (target, name, value) => {
      const el = fromHostElement(target)
      if (value === false || value === null || value === undefined) delete el.props[name]
      else el.props[name] = value
    },

    getProperty: (target, name) => fromHostElement(target).props[name],

    setStyle: (target, value) => {
      fromHostElement(target).style = value
    },

    setVisible: (target, visible) => {
      fromHostElement(target).visible = visible
    },

    addEventListener: (target, name, handler) => {
      const el = fromHostElement(target)
      const existing = el.listeners.get(name) ?? new Set<HostEventHandler>()
      existing.add(handler)
      el.listeners.set(name, existing)
      return () => {
        existing.delete(handler)
      }
    },

    insert: (parent, node, anchor) => {
      const parentEl = fromHostElement(parent)
      const child = requireMemoryNode(node)
      // Detach first so an insert doubles as a move, which is exactly what the
      // list reconciler relies on when rows change position.
      detach(child)
      const at = anchor === null ? -1 : parentEl.children.indexOf(fromHostNode(anchor))
      if (at === -1) parentEl.children.push(child)
      else parentEl.children.splice(at, 0, child)
      child.parent = parentEl
    },

    remove: (node) => detach(fromHostNode(node)),

    clear: (target) => {
      const el = fromHostElement(target)
      for (const child of el.children) child.parent = null
      el.children.length = 0
    },

    firstChild: (target) => {
      const first = fromHostElement(target).children[0]
      return first === undefined ? null : toHostNode(first)
    },

    nextSibling: (node) => {
      const child = fromHostNode(node)
      const siblings = child.parent?.children
      if (!siblings) return null
      const next = siblings[siblings.indexOf(child) + 1]
      return next === undefined ? null : toHostNode(next)
    },
  }

  return { host, root, rootElement: toHostElement(root) }
}

/** Builds a bare element with every field initialised, so no consumer sees a partial node. */
const element = (tag: string): MemoryElement => ({
  kind: 'element',
  tag,
  props: {},
  listeners: new Map(),
  children: [],
  style: null,
  visible: true,
  parent: null,
})

/**
 * Checks that something really is a node this host made, before it is linked
 * into the tree.
 *
 * Every host crosses the opaque-handle boundary with a cast, and a cast believes
 * whatever it is told — so anything that slips past the types (a `Date`, a plain
 * object, a promise) lands in the tree as a child that nothing can render or
 * serialise, and the failure surfaces somewhere far away. This host is also the
 * test host, which makes a loud error here worth far more than the microscopic
 * cost of the check: a test that hands over the wrong thing says so immediately.
 */
const requireMemoryNode = (node: HostNode): MemoryNode => {
  const candidate = node as unknown
  if (typeof candidate === 'object' && candidate !== null) {
    const kind = (candidate as { kind?: unknown }).kind
    if (kind === 'element' || kind === 'text') return candidate as MemoryNode
  }
  throw new TypeError(
    `The memory host can only insert nodes it created, and received ${String(candidate)} instead. ` +
      'A value like this usually reaches the tree as a child that is neither a host node, a string, ' +
      'nor a function — convert it to a string first.',
  )
}

/** Unlinks a node from whatever parent currently holds it. */
const detach = (node: MemoryNode): void => {
  const parent = node.parent
  if (!parent) return
  const at = parent.children.indexOf(node)
  if (at !== -1) parent.children.splice(at, 1)
  node.parent = null
}

/*
 * The runtime treats host nodes as opaque handles, which is what keeps it from
 * ever depending on a particular platform's node type. Every host therefore
 * crosses that boundary with a cast, and confining those casts to the four
 * helpers below means the rest of the adapter stays fully typed against its own
 * concrete types.
 */
const toHostElement = (node: MemoryElement): HostElement => node as unknown as HostElement
const toHostText = (node: MemoryText): HostText => node as unknown as HostText
const toHostNode = (node: MemoryNode): HostNode => node as unknown as HostNode
const fromHostElement = (node: HostElement): MemoryElement => node as unknown as MemoryElement
const fromHostText = (node: HostText): MemoryText => node as unknown as MemoryText
const fromHostNode = (node: HostNode): MemoryNode => node as unknown as MemoryNode
