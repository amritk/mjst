import type { ClassValue, HostElement, MaybeReactive, MiniChildren, StyleValue } from './types'

/**
 * The element vocabulary every host renders.
 *
 * These are NOT HTML tags. A native view tree has no `<div>`, and typing the
 * JSX surface against `HTMLElementTagNameMap` would both pull the DOM library
 * into the core and promise elements no native target can produce. Instead the
 * vocabulary is a small platform-neutral set — the same handful of primitives
 * every native UI toolkit agrees on — and each host maps it onto whatever it
 * actually renders.
 *
 * That inversion is what makes the DOM host a web PREVIEW target for a native
 * app rather than the other way around: it renders `view` as a `<div>` and
 * `text` as a `<span>`, so the same component tree runs in a browser during
 * development and on a device in production.
 */
export type ElementTag = 'view' | 'text' | 'image' | 'scroll-view' | 'input'

/** The tags above as a runtime set, for hosts that want to validate a tag. */
export const ELEMENT_TAGS = ['view', 'text', 'image', 'scroll-view', 'input'] as const

/**
 * Handlers common to every element. Names are the native idiom rather than the
 * web one — `onTap` instead of `onClick` — because tapping is the gesture that
 * actually exists on a device. The DOM host maps them back onto mouse events.
 *
 * There is no delegation and no capture phase: native targets have no bubbling
 * to hook into, so every listener is attached directly to its element.
 */
type EventHandlers = {
  onTap?: (event: unknown) => void
  onLongPress?: (event: unknown) => void
  onFocus?: (event: unknown) => void
  onBlur?: (event: unknown) => void
}

/** Props accepted by every element in the vocabulary. */
type CommonProps = {
  children?: MiniChildren
  /**
   * Called with the element once its children are attached. This is the escape
   * hatch for anything with no prop form — wiring an extra listener, holding a
   * reference for imperative focus, calling a binding by hand.
   */
  ref?: (element: HostElement) => void
  /**
   * Reactive visibility, wired to the host's `setVisible`. A plain boolean
   * applies once, a getter tracks. This hides in place; adding and removing
   * elements structurally is what the control-flow components are for.
   */
  show?: MaybeReactive<boolean>
  /** Accepted because JSX reserves it, ignored at runtime — keying lives in `list`. */
  key?: string | number
  class?: MaybeReactive<ClassValue>
  style?: MaybeReactive<StyleValue | null>
  id?: MaybeReactive<string>
  /** A stable handle for UI tests, passed straight through to the host. */
  testId?: MaybeReactive<string>
} & EventHandlers

/** Per-tag props, layered on top of {@link CommonProps}. */
type TagProps = {
  view: object
  text: {
    /** Truncate after this many lines. Maps to the host's own line-clamp. */
    lines?: MaybeReactive<number>
  }
  image: {
    src?: MaybeReactive<string>
    /** Accessible description. Native targets surface this to screen readers. */
    alt?: MaybeReactive<string>
    /** How the image fills its box. The names match the CSS `object-fit` values the DOM host maps onto. */
    fit?: MaybeReactive<'cover' | 'contain' | 'fill' | 'none'>
    onLoad?: (event: unknown) => void
    onError?: (event: unknown) => void
  }
  'scroll-view': {
    /** Scroll axis. Defaults to vertical, matching every native scroll container. */
    direction?: MaybeReactive<'vertical' | 'horizontal'>
    onScroll?: (event: unknown) => void
  }
  input: {
    value?: MaybeReactive<string>
    placeholder?: MaybeReactive<string>
    disabled?: MaybeReactive<boolean>
    readonly?: MaybeReactive<boolean>
    /** Grows to multiple lines. The DOM host renders a textarea for this. */
    multiline?: MaybeReactive<boolean>
    /** Which on-screen keyboard to raise. Native targets have no text `type`, they have a keyboard mode. */
    keyboard?: MaybeReactive<'text' | 'number' | 'email' | 'phone' | 'password'>
    onInput?: (event: unknown) => void
    onChange?: (event: unknown) => void
  }
}

/** The complete prop type for one tag. */
export type ElementProps<Tag extends ElementTag> = CommonProps & TagProps[Tag]

/**
 * The loose bag the runtime iterates. Call sites are checked richly through
 * `JSX.IntrinsicElements`; by the time props reach `jsx` they are just a
 * string-keyed object, and `unknown` forces the runtime to narrow each value
 * before it uses it.
 */
export type ElementPropBag = { readonly [prop: string]: unknown }
