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

// ---------------------------------------------------------------------------
// Typed props: events, globals, per-element attributes
// ---------------------------------------------------------------------------

/**
 * A DOM event whose `currentTarget` is narrowed to the element the handler is
 * bound to. `target` stays the base `EventTarget | null` (the actual click
 * may land on a descendant); only `currentTarget` — the listening element —
 * is known precisely.
 */
export type TargetedEvent<E extends HTMLElement, Ev extends Event> = Ev & { readonly currentTarget: E }

/**
 * The `on*` handlers mini wires, each carrying the precise DOM event type and
 * an element-narrowed `currentTarget`. The runtime lowercases the name after
 * `on` (`onKeyDown` → `keydown`), so these React-style names map onto real
 * event names. Only the events the widget uses are listed; adding one is a
 * single line here plus nothing at runtime (the generic `on*` path handles
 * any listener).
 */
type EventHandlers<E extends HTMLElement> = {
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
type SpecialProps<E extends HTMLElement> = {
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
  class?: MaybeReactive<string>
  id?: MaybeReactive<string>
  title?: MaybeReactive<string | null>
  role?: MaybeReactive<string>
  style?: MaybeReactive<string>
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
  }
  textarea: {
    value?: MaybeReactive<string>
    placeholder?: MaybeReactive<string>
    disabled?: MaybeReactive<boolean>
    rows?: MaybeReactive<number | string>
  }
  label: { for?: MaybeReactive<string> }
}

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

/**
 * Applies one attribute with `bindAttr` semantics: `false`/`null`/`undefined`
 * remove it, `true` sets it bare, everything else is stringified. Shared by
 * the static and reactive paths so both behave identically.
 */
const setAttribute = (element: HTMLElement, name: string, value: unknown): void => {
  if (value === false || value === null || value === undefined) element.removeAttribute(name)
  else element.setAttribute(name, value === true ? '' : String(value))
}

/**
 * Appends children. Strings and numbers become text nodes, nodes are moved
 * in, arrays recurse, and `null`/`undefined`/booleans vanish — which is what
 * makes `{cond && <span>…</span>}` work for build-time conditionals. A
 * function child becomes a reactive text node bound to the values it reads.
 */
const appendChildren = (element: HTMLElement, children: MiniChildren): void => {
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

  const element = document.createElement(tag)
  let ref: ((el: HTMLElement) => void) | undefined

  for (const [name, value] of Object.entries(props)) {
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
      bindShow(element, get)
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

  ref?.(element)
  return element
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
export namespace JSX {
  export type Element = HTMLElement
  export type IntrinsicElements = {
    [Tag in keyof HTMLElementTagNameMap]: IntrinsicProps<Tag>
  }
  export type ElementChildrenAttribute = {
    children: MiniChildren
  }
}
