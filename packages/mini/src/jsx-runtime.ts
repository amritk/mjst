import { effect } from 'alien-signals'

import { bindShow } from './bind'

/**
 * mini's JSX runtime — the automatic runtime TypeScript targets when a
 * package sets `"jsx": "react-jsx", "jsxImportSource": "@amritk/mini"`.
 * JSX here produces REAL DOM ELEMENTS, immediately, exactly once. There is no
 * virtual DOM, no diffing, and no re-render: a component function runs a
 * single time and returns the `HTMLElement` it built.
 *
 * ## The reactivity rule (the one thing to remember)
 *
 * There is no compiler analysing expressions, so reactivity is decided by
 * VALUE SHAPE at runtime:
 *
 * - A FUNCTION-valued attribute, child, or `show` is reactive: the runtime
 *   wraps it in an effect and re-applies it whenever the signals it reads
 *   change.
 * - Any other value is static: applied once at creation, never again.
 *
 * Signals are zero-argument functions, so passing one WITHOUT CALLING IT is
 * already a live binding:
 *
 *     <button disabled={streaming}>          // reactive — updates forever
 *     <button disabled={streaming()}>        // STATIC — frozen at creation!
 *     <span>{() => count() * 2}</span>       // reactive derived text
 *
 * The middle line is the whole footgun of a compilerless JSX: calling the
 * signal reads it once and hands the runtime a plain boolean. When an
 * attribute should track state, pass the signal itself or a thunk. The
 * attribute types below encode this as `MaybeReactive<T>`, so both forms
 * typecheck.
 *
 * ## What is deliberately NOT here (the mini charter, applied to JSX)
 *
 * - No fragments (`<>…</>`): every piece of UI is one root element, the same
 *   shape the old SFCs and `template()` produced. Attempting a fragment is a
 *   compile error (no `Fragment` export), which is the intended experience.
 * - No conditional/list rendering in expressions: a function child is a
 *   reactive TEXT binding only. Structural changes go through `show`
 *   (visibility, wired to `bindShow`) and `list` (keyed collections) — the
 *   tested primitives.
 * - No `innerHTML`/`dangerouslySetInnerHTML` prop: `bindHtml`, with its
 *   explicit sanitizer argument, stays the single sanctioned HTML sink.
 * - No event options (capture/passive/once) and no delegation: `on*` props
 *   map to plain `addEventListener`. Anything fancier takes a `ref`.
 * - `key` is accepted (JSX syntax reserves it) and ignored — keying lives in
 *   `list`, the only place mini reconciles collections.
 */

// ---------------------------------------------------------------------------
// Value shapes
// ---------------------------------------------------------------------------

/**
 * A prop value that may be static or a reactive getter. A signal satisfies
 * the getter arm as-is (it is a zero-arg function), so `disabled={streaming}`
 * typechecks and binds live; `disabled={true}` typechecks and is static.
 */
export type MaybeReactive<T> = T | (() => T)

/** A static child, rendered once. Functions are handled separately as reactive text. */
type StaticChild = Node | string | number | boolean | null | undefined

/** Anything that may appear between an element's tags. A function is a reactive text binding. */
export type MiniChild = StaticChild | (() => string | number | boolean | null | undefined)

export type MiniChildren = MiniChild | readonly MiniChild[]

/**
 * The value forms `class` accepts. A plain string is applied verbatim; an array
 * drops falsy entries and joins with spaces (`['btn', active && 'on']`); an
 * object keeps the keys whose value is truthy (`{ btn: true, on: active() }`).
 * The whole thing is still `MaybeReactive`, so wrap it in a getter to track.
 */
export type ClassValue = string | readonly (string | false | null | undefined)[] | Record<string, boolean>

/**
 * The value forms `style` accepts: a `cssText` string, or an object of
 * properties (camelCase or kebab-case keys, `--custom` props included). Numbers
 * are stringified as-is — add units yourself where CSS needs them.
 */
export type StyleValue = string | Record<string, string | number | null | undefined | false>

// ---------------------------------------------------------------------------
// Typed props: events, globals, per-element attributes
// ---------------------------------------------------------------------------

/**
 * A DOM event whose `currentTarget` is narrowed to the element the handler is
 * bound to. `target` stays the base `EventTarget | null` (the actual click
 * may land on a descendant); only `currentTarget` — the listening element —
 * is known precisely.
 */
export type TargetedEvent<E extends Element, Ev extends Event> = Ev & { readonly currentTarget: E }

/**
 * The `on*` handlers mini wires, each carrying the precise DOM event type and
 * an element-narrowed `currentTarget`. The runtime lowercases the name after
 * `on` (`onKeyDown` → `keydown`), so these React-style names map onto real
 * event names. Only the events the widget uses are listed; adding one is a
 * single line here plus nothing at runtime (the generic `on*` path handles
 * any listener).
 */
type EventHandlers<E extends Element> = {
  onClick?: (event: TargetedEvent<E, MouseEvent>) => void
  onInput?: (event: TargetedEvent<E, InputEvent>) => void
  onChange?: (event: TargetedEvent<E, Event>) => void
  onKeyDown?: (event: TargetedEvent<E, KeyboardEvent>) => void
  onKeyUp?: (event: TargetedEvent<E, KeyboardEvent>) => void
  onSubmit?: (event: TargetedEvent<E, SubmitEvent>) => void
  onFocus?: (event: TargetedEvent<E, FocusEvent>) => void
  onBlur?: (event: TargetedEvent<E, FocusEvent>) => void
  onPointerDown?: (event: TargetedEvent<E, PointerEvent>) => void
  onError?: (event: TargetedEvent<E, Event>) => void
  onLoad?: (event: TargetedEvent<E, Event>) => void
}

/**
 * The mini-specific props every element accepts, parameterised by the element
 * type so `ref` lands on the concrete node (`<button ref>` gives an
 * `HTMLButtonElement`).
 */
type SpecialProps<E extends Element> = {
  children?: MiniChildren
  /**
   * Called with the created element after its children are appended — the
   * JSX replacement for `template()`'s `data-ref` dictionary, and the escape
   * hatch for wiring with no prop form (extra listeners, focus management,
   * one-off `bind*` calls).
   */
  ref?: (element: E) => void
  /**
   * Reactive visibility, wired to `bindShow` (toggles inline `display`). A
   * boolean shows/hides once; a getter tracks. This is mini's `v-if` for the
   * common show/hide case — structural add/remove still belongs to `list`.
   */
  show?: MaybeReactive<boolean>
  /** Accepted because JSX reserves it, ignored at runtime — keying lives in `list`. */
  key?: string | number
}

/** Global attributes valid on any element. Each is static-or-reactive. */
type GlobalAttributes = {
  class?: MaybeReactive<ClassValue>
  id?: MaybeReactive<string>
  title?: MaybeReactive<string | null>
  role?: MaybeReactive<string>
  style?: MaybeReactive<StyleValue>
  tabindex?: MaybeReactive<number | string>
  hidden?: MaybeReactive<boolean>
  draggable?: MaybeReactive<boolean>
}

/**
 * The open `aria-*` / `data-*` attribute sets. Template-literal index
 * signatures keep arbitrary custom attributes typed (and still reject typos
 * like `clas`, which match neither pattern nor a named prop).
 */
type AriaDataAttributes = {
  [key: `aria-${string}`]: MaybeReactive<string | boolean | number | null> | undefined
  [key: `data-${string}`]: MaybeReactive<string | number | boolean | null> | undefined
}

/**
 * Per-element attributes, typed only for the tags the widget uses. A tag
 * absent here still gets globals, aria/data, events, and the special props —
 * just no element-specific attributes, which keeps this table small without
 * losing safety on what it does cover.
 */
type ElementAttributes = {
  a: { href?: MaybeReactive<string>; target?: MaybeReactive<string>; rel?: MaybeReactive<string> }
  button: { type?: MaybeReactive<'button' | 'submit' | 'reset'>; disabled?: MaybeReactive<boolean> }
  img: { src?: MaybeReactive<string>; alt?: MaybeReactive<string>; loading?: MaybeReactive<'lazy' | 'eager'> }
  input: {
    type?: MaybeReactive<string>
    value?: MaybeReactive<string>
    placeholder?: MaybeReactive<string>
    disabled?: MaybeReactive<boolean>
    required?: MaybeReactive<boolean>
    autocomplete?: MaybeReactive<string>
    name?: MaybeReactive<string>
    checked?: MaybeReactive<boolean>
    /** File-input filter, e.g. `'image/*'` or `'.csv,text/csv'`. */
    accept?: MaybeReactive<string>
    min?: MaybeReactive<number | string>
    max?: MaybeReactive<number | string>
    step?: MaybeReactive<number | string>
    multiple?: MaybeReactive<boolean>
    readonly?: MaybeReactive<boolean>
  }
  textarea: {
    value?: MaybeReactive<string>
    placeholder?: MaybeReactive<string>
    disabled?: MaybeReactive<boolean>
    rows?: MaybeReactive<number | string>
    name?: MaybeReactive<string>
    required?: MaybeReactive<boolean>
    readonly?: MaybeReactive<boolean>
  }
  label: { for?: MaybeReactive<string> }
  form: {
    action?: MaybeReactive<string>
    method?: MaybeReactive<'get' | 'post'>
    novalidate?: MaybeReactive<boolean>
    autocomplete?: MaybeReactive<string>
  }
  select: {
    value?: MaybeReactive<string>
    name?: MaybeReactive<string>
    disabled?: MaybeReactive<boolean>
    required?: MaybeReactive<boolean>
    multiple?: MaybeReactive<boolean>
  }
  option: {
    value?: MaybeReactive<string>
    selected?: MaybeReactive<boolean>
    disabled?: MaybeReactive<boolean>
  }
}

/**
 * The presentational and geometry attributes SVG elements reach for most.
 * Kebab-case names (`stroke-width`, `stop-color`) are written as string keys, as
 * they appear in markup. Anything not listed still comes through `aria-*` /
 * `data-*` or a `ref`, matching how the HTML table stays scoped to what's used.
 */
type SvgAttributes = {
  viewBox?: MaybeReactive<string>
  xmlns?: MaybeReactive<string>
  width?: MaybeReactive<string | number>
  height?: MaybeReactive<string | number>
  x?: MaybeReactive<string | number>
  y?: MaybeReactive<string | number>
  x1?: MaybeReactive<string | number>
  y1?: MaybeReactive<string | number>
  x2?: MaybeReactive<string | number>
  y2?: MaybeReactive<string | number>
  cx?: MaybeReactive<string | number>
  cy?: MaybeReactive<string | number>
  r?: MaybeReactive<string | number>
  rx?: MaybeReactive<string | number>
  ry?: MaybeReactive<string | number>
  d?: MaybeReactive<string>
  points?: MaybeReactive<string>
  transform?: MaybeReactive<string>
  fill?: MaybeReactive<string>
  stroke?: MaybeReactive<string>
  opacity?: MaybeReactive<string | number>
  offset?: MaybeReactive<string | number>
  href?: MaybeReactive<string>
  preserveAspectRatio?: MaybeReactive<string>
  gradientUnits?: MaybeReactive<string>
  gradientTransform?: MaybeReactive<string>
  'stroke-width'?: MaybeReactive<string | number>
  'stroke-linecap'?: MaybeReactive<'butt' | 'round' | 'square'>
  'stroke-linejoin'?: MaybeReactive<'miter' | 'round' | 'bevel'>
  'stroke-dasharray'?: MaybeReactive<string | number>
  'stroke-dashoffset'?: MaybeReactive<string | number>
  'fill-opacity'?: MaybeReactive<string | number>
  'fill-rule'?: MaybeReactive<'nonzero' | 'evenodd'>
  'stroke-opacity'?: MaybeReactive<string | number>
  'stop-color'?: MaybeReactive<string>
  'stop-opacity'?: MaybeReactive<string | number>
  'clip-path'?: MaybeReactive<string>
  'text-anchor'?: MaybeReactive<'start' | 'middle' | 'end'>
}

/** The full prop type for one SVG (namespaced) element. */
export type SvgProps<Tag extends keyof SVGElementTagNameMap> = GlobalAttributes &
  AriaDataAttributes &
  SpecialProps<SVGElementTagNameMap[Tag]> &
  EventHandlers<SVGElementTagNameMap[Tag]> &
  SvgAttributes

/** The full prop type for one intrinsic (tag-named) element. */
export type IntrinsicProps<Tag extends keyof HTMLElementTagNameMap> = GlobalAttributes &
  AriaDataAttributes &
  SpecialProps<HTMLElementTagNameMap[Tag]> &
  EventHandlers<HTMLElementTagNameMap[Tag]> &
  (Tag extends keyof ElementAttributes ? ElementAttributes[Tag] : object)

/** A component: a plain function, run exactly once, returning its root element. */
export type Component<P> = (props: P) => HTMLElement

/**
 * The loose prop bag the runtime iterates over. Call sites are validated
 * richly through `JSX.IntrinsicElements` (or a component's own signature); by
 * the time props reach `jsx` at runtime they are just a string-keyed object,
 * so an index of `unknown` both accepts every rich prop shape and forces the
 * runtime to narrow each value before using it.
 */
export type MiniElementProps = { readonly [prop: string]: unknown }

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

/** Tag names that must be created in the SVG namespace, not as HTML elements. */
const SVG_TAGS = new Set([
  'svg',
  'g',
  'path',
  'circle',
  'ellipse',
  'line',
  'rect',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'defs',
  'use',
  'symbol',
  'image',
  'marker',
  'pattern',
  'mask',
  'clipPath',
  'linearGradient',
  'radialGradient',
  'stop',
  'filter',
  'foreignObject',
])

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * Creates the backing element, choosing the SVG namespace for SVG tags so
 * `<svg>`/`<path>`/… are real `SVGElement`s that actually render (a plain
 * `createElement('svg')` makes an inert HTML element in the wrong namespace).
 */
const createElement = (tag: string): HTMLElement | SVGElement =>
  SVG_TAGS.has(tag) ? document.createElementNS(SVG_NS, tag) : document.createElement(tag)

/**
 * Applies one attribute with `bindAttr` semantics: `false`/`null`/`undefined`
 * remove it, `true` sets it bare, everything else is stringified. Shared by
 * the static and reactive paths so both behave identically.
 */
const setAttribute = (element: Element, name: string, value: unknown): void => {
  if (value === false || value === null || value === undefined) element.removeAttribute(name)
  else element.setAttribute(name, value === true ? '' : String(value))
}

/** Collapses a {@link ClassValue} (string, array, or toggle-map) into a className string. */
const resolveClass = (value: unknown): string => {
  if (Array.isArray(value)) return value.filter(Boolean).join(' ')
  if (value !== null && typeof value === 'object') {
    // Accumulate the truthy keys directly instead of chaining
    // `entries().filter().map().join()`, which allocates three throwaway arrays
    // on every reactive class update.
    let result = ''
    for (const name in value as Record<string, unknown>) {
      if ((value as Record<string, unknown>)[name]) result += result ? ` ${name}` : name
    }
    return result
  }
  return value === null || value === undefined || value === false ? '' : String(value)
}

/** Converts a camelCase style key to its kebab-case CSS name (leaving `--custom` props alone). */
const cssName = (key: string): string =>
  key.startsWith('--') ? key : key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)

/** Applies a {@link StyleValue}: a string sets `style` wholesale, an object sets each property. */
const applyStyle = (element: Element, value: unknown): void => {
  const style = (element as HTMLElement | SVGElement).style
  if (value === null || value === undefined || value === false) {
    element.removeAttribute('style')
    return
  }
  if (typeof value === 'object') {
    style.cssText = ''
    // `for…in` rather than `Object.entries`: no per-update tuple array, and
    // style objects are plain literals with no inherited enumerables.
    for (const key in value as Record<string, unknown>) {
      const entry = (value as Record<string, unknown>)[key]
      if (entry === null || entry === undefined || entry === false) continue
      style.setProperty(cssName(key), String(entry))
    }
    return
  }
  setAttribute(element, 'style', value)
}

/**
 * Appends children. Strings and numbers become text nodes, nodes are moved
 * in, arrays recurse, and `null`/`undefined`/booleans vanish — which is what
 * makes `{cond && <span>…</span>}` work for build-time conditionals. A
 * function child becomes a reactive text node bound to the values it reads.
 */
const appendChildren = (element: Element, children: MiniChildren): void => {
  if (children === null || children === undefined || typeof children === 'boolean') return
  if (Array.isArray(children)) {
    for (const child of children) appendChildren(element, child as MiniChildren)
    return
  }
  if (typeof children === 'function') {
    // Reactive text. The dedicated node means sibling children (icons, other
    // bindings) are never clobbered by this binding's updates.
    const text = document.createTextNode('')
    const get = children
    effect(() => {
      const value = get()
      text.textContent = value === null || value === undefined || value === false ? '' : String(value)
    })
    element.appendChild(text)
    return
  }
  if (children instanceof Node) {
    element.appendChild(children)
    return
  }
  element.appendChild(document.createTextNode(String(children)))
}

/**
 * The automatic-runtime entry point. TypeScript/esbuild compile
 * `<div class="x">{y}</div>` into `jsx('div', { class: 'x', children: y })`;
 * a capitalised tag arrives as its component function instead of a string.
 */
export const jsx = (tag: string | Component<never>, props: MiniElementProps, _key?: unknown): HTMLElement => {
  // Components run exactly once — there is no instance, no lifecycle, no
  // re-render. Whatever reactivity the component sets up internally (its
  // bindings) is the only thing that ever updates afterwards.
  if (typeof tag === 'function') return (tag as (props: MiniElementProps) => HTMLElement)(props)

  const element = createElement(tag)
  let ref: ((el: HTMLElement) => void) | undefined

  // `for…in` over the props object rather than `Object.entries(props)`: the
  // latter allocates an array of `[key, value]` tuples on every element built,
  // and element creation is the framework's hottest path. Props always arrive
  // as a plain object literal from the JSX transform, so there are no inherited
  // enumerables to filter out.
  for (const name in props) {
    const value = props[name]
    if (name === 'children') {
      appendChildren(element, value as MiniChildren)
    } else if (name === 'key') {
      // Reserved by JSX syntax; keying belongs to `list`, so ignore it.
    } else if (name === 'ref') {
      // Deferred below so the callback sees the fully-built element.
      ref = value as (el: HTMLElement) => void
    } else if (name === 'show') {
      // Reactive visibility. A getter tracks; a static boolean is wrapped so
      // one code path (bindShow) handles both.
      const get = typeof value === 'function' ? (value as () => boolean) : () => value as boolean
      bindShow(element as HTMLElement, get)
    } else if (name === 'class') {
      // `class` accepts a string, an array, or a toggle-map; a function tracks.
      // Everything funnels through `resolveClass` so both forms behave alike.
      if (typeof value === 'function') effect(() => setAttribute(element, 'class', resolveClass(value())))
      else setAttribute(element, 'class', resolveClass(value))
    } else if (name === 'style') {
      // `style` accepts a cssText string or a property object; a function tracks.
      if (typeof value === 'function') effect(() => applyStyle(element, (value as () => unknown)()))
      else applyStyle(element, value)
    } else if (name.startsWith('on') && typeof value === 'function') {
      // onClick → click, onPointerDown → pointerdown. Plain listener, bubble
      // phase — options and delegation are out of scope by charter.
      element.addEventListener(name.slice(2).toLowerCase(), value as EventListener)
    } else if (typeof value === 'function') {
      // The reactivity rule: a function-valued attribute is a live binding.
      // Signals qualify as-is, so `disabled={streaming}` tracks forever.
      const get = value as () => unknown
      effect(() => setAttribute(element, name, get()))
    } else {
      setAttribute(element, name, value)
    }
  }

  ref?.(element as HTMLElement)
  return element as HTMLElement
}

/**
 * The multi-children variant of `jsx`. The automatic runtime calls this when
 * an element has several children; our `jsx` already handles arrays, so it
 * is the same function.
 */
export const jsxs = jsx

/**
 * Development-runtime variant (bun and vite import it from jsx-dev-runtime
 * in dev mode). The extra debug parameters — source location, `this` — have
 * nothing to attach to in a framework with no component instances, so they
 * are accepted and dropped.
 */
export const jsxDEV = (
  tag: string | Component<never>,
  props: MiniElementProps,
  key?: unknown,
  _isStatic?: boolean,
  _source?: unknown,
  _self?: unknown,
): HTMLElement => jsx(tag, props, key)

/**
 * The JSX type surface TypeScript resolves from this module. Each intrinsic
 * tag is typed via `IntrinsicProps<Tag>` — globals, aria/data, per-element
 * attributes, element-narrowed events, `ref`, and `show` — and a JSX
 * expression IS the `HTMLElement` it creates, which is why a JSX expression
 * can be passed anywhere mini expects a node and components need no wrapper.
 */
/**
 * SVG tag names that do not also name an HTML element. The overlapping few
 * (`a`, `title`, `script`, `style`) stay on their HTML typing — `href` and the
 * globals cover their SVG use — so the two maps merge without colliding.
 */
type SvgOnlyTag = Exclude<keyof SVGElementTagNameMap, keyof HTMLElementTagNameMap>

export namespace JSX {
  export type Element = HTMLElement
  export type IntrinsicElements = {
    [Tag in keyof HTMLElementTagNameMap]: IntrinsicProps<Tag>
  } & {
    [Tag in SvgOnlyTag]: SvgProps<Tag>
  }
  export type ElementChildrenAttribute = {
    children: MiniChildren
  }
}
