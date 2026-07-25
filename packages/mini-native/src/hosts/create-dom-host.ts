import type { Host } from '../host'
import type { HostElement, HostNode, HostText } from '../types'

/**
 * A host that renders the element vocabulary into the DOM.
 *
 * Note which direction this adapter runs: the browser is the GUEST here. The
 * vocabulary is the native one, and this host maps it onto the nearest HTML
 * equivalent so a native component tree can be developed and previewed in a
 * browser — fast reload, real devtools — and then run unchanged on a device.
 * That is the opposite of treating the DOM as the real target and native as an
 * approximation of it, and it is why nothing above this file mentions HTML.
 *
 * Mutations apply immediately, so there is no `flush` and the scheduler skips
 * the commit step entirely.
 */
export const createDomHost = (): Host => ({
  createElement: (tag) => toHostElement(document.createElement(HTML_TAGS[tag] ?? 'div')),

  createFlowHost: () => {
    // `display: contents` makes the wrapper vanish from layout, so the branch
    // inside participates in the parent's flex or grid flow as though the
    // wrapper were not there. Native hosts need no such trick — a container
    // view is a perfectly ordinary thing to nest there.
    const wrapper = document.createElement('div')
    wrapper.style.display = 'contents'
    return toHostElement(wrapper)
  },

  createText: (value) => toHostText(document.createTextNode(value)),

  setText: (node, value) => {
    fromHostText(node).data = value
  },

  setProperty: (target, name, value) => {
    const element = fromHostElement(target)
    const attribute = ATTRIBUTES[name] ?? name

    // `value` has to go through the property rather than the attribute: the
    // attribute only seeds the initial value, so writing it would leave the
    // field showing whatever the user last typed.
    if (attribute === 'value' && 'value' in element) {
      ;(element as HTMLInputElement).value = value === null || value === undefined ? '' : String(value)
      return
    }

    if (value === false || value === null || value === undefined) element.removeAttribute(attribute)
    else element.setAttribute(attribute, value === true ? '' : String(value))
  },

  getProperty: (target, name) => {
    const element = fromHostElement(target)
    if (name === 'value' && 'value' in element) return (element as HTMLInputElement).value
    if (name === 'checked' && 'checked' in element) return (element as HTMLInputElement).checked
    return element.getAttribute(ATTRIBUTES[name] ?? name)
  },

  setStyle: (target, value) => {
    const element = fromHostElement(target)
    if (value === null) {
      element.removeAttribute('style')
      return
    }
    element.style.cssText = ''
    for (const [key, entry] of Object.entries(value)) {
      if (entry === null || entry === undefined || entry === false) continue
      element.style.setProperty(cssName(key), String(entry))
    }
  },

  setVisible: (target, visible) => {
    fromHostElement(target).style.display = visible ? '' : 'none'
  },

  addEventListener: (target, name, handler) => {
    const element = fromHostElement(target)
    const domName = EVENTS[name] ?? name
    element.addEventListener(domName, handler)
    return () => element.removeEventListener(domName, handler)
  },

  insert: (parent, node, anchor) => {
    fromHostElement(parent).insertBefore(fromHostNode(node), anchor === null ? null : fromHostNode(anchor))
  },

  remove: (node) => fromHostNode(node).remove(),

  clear: (target) => fromHostElement(target).replaceChildren(),

  firstChild: (target) => {
    const first = fromHostElement(target).firstChild
    return first === null ? null : toHostNode(first)
  },

  nextSibling: (node) => {
    const next = fromHostNode(node).nextSibling
    return next === null ? null : toHostNode(next)
  },
})

/**
 * Wraps an existing DOM element as a mount target, so an app can be attached to
 * a real container without the runtime ever exposing a DOM type.
 *
 * @example
 * ```ts
 * setHost(createDomHost())
 * mount(domRoot(document.body), App)
 * ```
 */
export const domRoot = (element: Element): HostElement => toHostElement(element)

/**
 * How the element vocabulary lands in HTML. Anything unmapped becomes a `div`,
 * which is the harmless default — an unknown container renders as a container.
 *
 * `scroll-view` is a plain div here; the scrolling itself comes from the
 * `direction` prop, which maps to an overflow style below.
 */
const HTML_TAGS: Record<string, string> = {
  view: 'div',
  text: 'span',
  image: 'img',
  'scroll-view': 'div',
  input: 'input',
}

/** Vocabulary prop names that have a different spelling in HTML. */
const ATTRIBUTES: Record<string, string> = {
  testId: 'data-testid',
  keyboard: 'type',
}

/**
 * Native gesture names mapped onto the DOM events that stand in for them.
 * Anything unmapped passes through unchanged, which is what lets the composition
 * events the two-way input binding listens for reach the element directly.
 */
const EVENTS: Record<string, string> = {
  tap: 'click',
  longpress: 'contextmenu',
}

/** Converts a camelCase style key to its CSS spelling, leaving custom properties alone. */
const cssName = (key: string): string =>
  key.startsWith('--') ? key : key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)

/*
 * Host nodes are opaque to the runtime, so the adapter crosses that boundary
 * with a cast. Confining the casts to these helpers keeps everything above
 * fully typed against real DOM types.
 */
const toHostElement = (node: Element): HostElement => node as unknown as HostElement
const toHostText = (node: Text): HostText => node as unknown as HostText
const toHostNode = (node: Node): HostNode => node as unknown as HostNode
const fromHostElement = (node: HostElement): HTMLElement => node as unknown as HTMLElement
const fromHostText = (node: HostText): Text => node as unknown as Text
const fromHostNode = (node: HostNode): ChildNode => node as unknown as ChildNode
