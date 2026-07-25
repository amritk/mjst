import type { Host } from '../host'
import type { HostElement, HostNode, HostText } from '../types'
import { toStyleText } from './to-style-text'

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
export const createDomHost = (): Host => {
  /**
   * The host's own style layer, kept per element.
   *
   * Three separate things want to write inline styles here — the user's `style`
   * bag, `setVisible`, and the props that only exist as styles on the web
   * (`fit`, `lines`, `direction`) — and `setStyle` replaces the inline style
   * wholesale, so the last two would be erased by any style write. The fix is to
   * remember what the host itself asked for and re-assert it afterwards.
   *
   * A genuinely separate channel is possible on the web — a stylesheet plus a
   * generated class per element — but that buys a document-level singleton and a
   * class-name allocator for a preview host, which is a lot of machinery for the
   * same guarantee. Layering through one WeakMap keeps the host self-contained
   * and leaves the element carrying exactly the styles it appears to carry.
   */
  const layers = new WeakMap<HTMLElement, DomStyleLayer>()

  const layerOf = (element: HTMLElement): DomStyleLayer => {
    const existing = layers.get(element)
    if (existing) return existing
    const created: DomStyleLayer = { owned: new Map(), styleDisplay: null, hidden: false }
    layers.set(element, created)
    return created
  }

  /**
   * Resolves the one `display` three features are competing for.
   *
   * Hiding always wins, because `setVisible` owns visibility outright. After
   * that a host-owned display wins, since the props that set one (a line clamp,
   * the flow wrapper) simply do not work without it. Only then does the user's
   * own style bag get a say, and an empty string means "whatever this element
   * displays as naturally".
   */
  const applyDisplay = (element: HTMLElement, layer: DomStyleLayer): void => {
    element.style.display = layer.hidden ? 'none' : (layer.owned.get('display') ?? layer.styleDisplay ?? '')
  }

  /** Re-asserts the host's layer over whatever the style bag just wrote. */
  const applyLayer = (element: HTMLElement, layer: DomStyleLayer): void => {
    for (const [property, value] of layer.owned) element.style.setProperty(property, value)
    applyDisplay(element, layer)
  }

  /** Adds or drops one host-owned declaration, pushing the result to the element. */
  const own = (element: HTMLElement, property: string, value: string | null): void => {
    const layer = layerOf(element)
    if (value === null) {
      layer.owned.delete(property)
      element.style.removeProperty(property)
    } else {
      layer.owned.set(property, value)
      element.style.setProperty(property, value)
    }
    applyDisplay(element, layer)
  }

  /**
   * Handles the vocabulary props that are structure or layout on the web rather
   * than attributes, and reports whether it took the prop.
   *
   * Without this they reach the element as literal attributes — `<img
   * fit="cover">`, `<span lines="2">` — which the browser ignores, so the
   * preview quietly stops matching the device. They go through the host's own
   * style layer so a `style` prop on the same element cannot wipe them.
   */
  const applyLayoutProp = (element: HTMLElement, name: string, value: unknown): boolean => {
    const unset = value === false || value === null || value === undefined

    // `multiline` decided which element to build back in `createElement`, and a
    // node cannot change what it is, so there is nothing left to do — but it
    // must still be swallowed or it renders as a junk `multiline=""` attribute.
    if (name === 'multiline') return true

    if (name === 'fit') {
      own(element, 'object-fit', unset ? null : String(value))
      return true
    }

    if (name === 'lines') {
      // The line clamp is still only reachable through the `-webkit-` prefixed
      // properties, and it needs all four of them together: the clamp itself
      // does nothing without the box display, the vertical orientation, and the
      // overflow that hides the trimmed text.
      own(element, 'display', unset ? null : '-webkit-box')
      own(element, '-webkit-box-orient', unset ? null : 'vertical')
      own(element, 'overflow', unset ? null : 'hidden')
      own(element, '-webkit-line-clamp', unset ? null : String(value))
      return true
    }

    if (name === 'direction') {
      // A native scroll container scrolls one axis and pins the other, so both
      // are set rather than leaving the cross axis to spill. Anything that is
      // not an explicit `horizontal` — including no prop at all — is vertical,
      // which is the vocabulary's default.
      const horizontal = value === 'horizontal'
      own(element, 'overflow-x', horizontal ? 'auto' : 'hidden')
      own(element, 'overflow-y', horizontal ? 'hidden' : 'auto')
      return true
    }

    return false
  }

  return {
    createElement: (tag, props) => {
      const element = document.createElement(htmlTag(tag, props))
      // A `scroll-view` scrolls whether or not anyone wrote a `direction`, so it
      // is created as though the prop were already set to its default. A later
      // `direction` write simply replaces these.
      if (tag === 'scroll-view') applyLayoutProp(element, 'direction', undefined)
      return toHostElement(element)
    },

    createFlowHost: () => {
      // `display: contents` makes the wrapper vanish from layout, so the branch
      // inside participates in the parent's flex or grid flow as though the
      // wrapper were not there. Native hosts need no such trick — a container
      // view is a perfectly ordinary thing to nest there. It goes through the
      // host's layer so a style write on the wrapper cannot bring it back into
      // layout.
      const wrapper = document.createElement('div')
      own(wrapper, 'display', 'contents')
      return toHostElement(wrapper)
    },

    createText: (value) => toHostText(document.createTextNode(value)),

    setText: (node, value) => {
      fromHostText(node).data = value
    },

    setProperty: (target, name, value) => {
      const element = fromHostElement(target)
      if (applyLayoutProp(element, name, value)) return

      const attribute = ATTRIBUTES[name] ?? name

      // `value` has to go through the property rather than the attribute: the
      // attribute only seeds the initial value, so writing it would leave the
      // field showing whatever the user last typed.
      if (attribute === 'value' && 'value' in element) {
        ;(element as HTMLInputElement).value = value === null || value === undefined ? '' : String(value)
        return
      }

      // A textarea has no `type`, so a multiline input drops the keyboard mode
      // rather than growing an attribute the browser ignores.
      if (name === 'keyboard' && element.tagName === 'TEXTAREA') return
      const resolved = name === 'keyboard' && typeof value === 'string' ? (INPUT_TYPES[value] ?? value) : value

      if (resolved === false || resolved === null || resolved === undefined) element.removeAttribute(attribute)
      else element.setAttribute(attribute, resolved === true ? '' : String(resolved))
    },

    getProperty: (target, name) => {
      const element = fromHostElement(target)
      if (name === 'value' && 'value' in element) return (element as HTMLInputElement).value
      if (name === 'checked' && 'checked' in element) return (element as HTMLInputElement).checked
      return element.getAttribute(ATTRIBUTES[name] ?? name)
    },

    setStyle: (target, value) => {
      const element = fromHostElement(target)
      const layer = layerOf(element)
      // Clearing the attribute rather than the declarations keeps an element
      // whose style bag emptied out from carrying a stray `style=""`.
      element.removeAttribute('style')
      layer.styleDisplay = null
      if (value !== null) {
        for (const [key, entry] of Object.entries(value)) {
          if (entry === null || entry === undefined || entry === false) continue
          const property = cssName(key)
          const text = toStyleText(key, entry)
          // Remembered rather than merely written, because `setVisible` has to
          // know what to put back when it shows the element again.
          if (property === 'display') layer.styleDisplay = text
          element.style.setProperty(property, text)
        }
      }
      applyLayer(element, layer)
    },

    setVisible: (target, visible) => {
      const element = fromHostElement(target)
      const layer = layerOf(element)
      layer.hidden = !visible
      applyDisplay(element, layer)
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
  }
}

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
 * What the DOM host remembers about an element that the element itself cannot
 * tell it, because the inline style is a single slot several features write to.
 */
type DomStyleLayer = {
  /** Declarations the host owns, keyed by CSS property, re-applied after every style write. */
  readonly owned: Map<string, string>
  /** The `display` the element's own style bag asked for, or `null` when it asked for none. */
  styleDisplay: string | null
  /** Whether the runtime has hidden this element through `setVisible`. */
  hidden: boolean
}

/**
 * Picks the HTML element to build.
 *
 * `multiline` is read here because the DOM offers no way to turn an `<input>`
 * into a `<textarea>` afterwards — the node's identity is fixed the moment it
 * exists. That makes it a STATIC prop: a getter would have to rebuild the
 * element to take effect, so rather than half-honouring one, a function value is
 * treated as "not supported here" and the input stays single-line. Writing
 * `multiline` as a plain boolean is the supported form.
 */
const htmlTag = (tag: string, props?: Readonly<Record<string, unknown>>): string => {
  const multiline = props?.['multiline']
  if (tag === 'input' && typeof multiline !== 'function' && Boolean(multiline)) return 'textarea'
  return HTML_TAGS[tag] ?? 'div'
}

/**
 * How the element vocabulary lands in HTML. Anything unmapped becomes a `div`,
 * which is the harmless default — an unknown container renders as a container.
 *
 * `scroll-view` is a plain div here; the scrolling itself comes from the
 * `direction` prop, which maps to an overflow style in `applyLayoutProp`.
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
 * Keyboard modes mapped onto the HTML input types that raise them.
 *
 * Most of the vocabulary happens to line up with a type name, but `phone` does
 * not: `type="phone"` is not a real input type, so the browser silently falls
 * back to plain text and the preview loses the numeric keypad the device shows.
 */
const INPUT_TYPES: Record<string, string> = {
  text: 'text',
  number: 'number',
  email: 'email',
  phone: 'tel',
  password: 'password',
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
