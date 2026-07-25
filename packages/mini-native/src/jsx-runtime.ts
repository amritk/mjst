import { appendChildren } from './append-children'
import { applyProp } from './apply-prop'
import { requireHost, scheduleFlush } from './current-host'
import type { ElementPropBag, ElementProps, ElementTag } from './elements'
import type { Component, HostElement, MiniChildren } from './types'

/**
 * The JSX runtime — the automatic runtime TypeScript targets when a package
 * sets `"jsx": "react-jsx", "jsxImportSource": "@amritk/mini-native"`.
 *
 * JSX here produces REAL HOST NODES, immediately, exactly once. There is no
 * virtual tree, no diffing, and no re-render: a component function runs a
 * single time and returns the element it built. Everything that changes
 * afterwards changes because a signal wrote to a node directly.
 *
 * That is what makes this port to a native target tractable. The hard part of
 * a React-style native framework is the reconciler — diffing a virtual tree and
 * committing minimal mutations. There is no reconciler here to port, so
 * targeting a new platform is a matter of implementing the `Host` contract and
 * nothing else.
 *
 * ## The reactivity rule
 *
 * No compiler analyses these expressions, so reactivity is decided by the SHAPE
 * of the value at runtime:
 *
 * - A FUNCTION-valued prop, child, or `show` is reactive: it is wrapped in an
 *   effect and re-applied whenever the signals it reads change.
 * - Any other value is static: applied once at creation, never again.
 *
 * Signals are zero-argument functions, so passing one WITHOUT CALLING IT is
 * already a live binding:
 *
 * ```tsx
 * <input disabled={busy} />            // reactive — tracks forever
 * <input disabled={busy()} />          // STATIC — frozen at creation
 * <text>{() => count() * 2}</text>     // reactive derived text
 * ```
 *
 * The middle line is the one footgun of a compilerless JSX: calling the signal
 * reads it once and hands the runtime a plain boolean.
 *
 * ## What is deliberately absent
 *
 * - No fragments. Every piece of UI is one root element, which is also how a
 *   native view tree works — there is no such thing as a parentless run of
 *   sibling views. Attempting `<>…</>` is a compile error, which is intended.
 * - No raw-markup sink. There is no `innerHTML` equivalent anywhere in the host
 *   contract, so bound data cannot inject elements on any target.
 * - No conditional or list rendering inside expressions. A function child is a
 *   reactive TEXT binding only; structural changes go through `Show`, `Dynamic`,
 *   and `For`.
 * - `key` on an ELEMENT is accepted (JSX reserves it) and ignored — keying lives
 *   in `list`, the one place collections are reconciled. On a COMPONENT it is
 *   forwarded as an ordinary prop; see the note in `jsx` for why that is not the
 *   same decision.
 */
export const jsx = (tag: ElementTag | Component<never>, props: ElementPropBag, key?: unknown): HostElement => {
  // A component runs exactly once. There is no instance and no lifecycle;
  // whatever reactivity it sets up internally is all that ever updates after.
  //
  // `key` is handed back to a component rather than dropped. The JSX transform
  // hoists any `key` attribute out of the props object and into this third
  // parameter before the component is ever called — a React convention this
  // runtime inherits from the transform whether it wants to or not — so a
  // component with a legitimate prop of that name would silently never receive
  // it. `For` is exactly that component: `<For each={rows} key={byId}>` would
  // quietly fall back to the default key, which is the kind of bug that shows
  // up as rows mysteriously not updating rather than as an error. There is no
  // competing meaning to protect here, because this framework does no
  // keying at the JSX level at all.
  if (typeof tag === 'function') {
    const withKey = key === undefined ? props : { ...props, key }
    return (tag as (props: ElementPropBag) => HostElement)(withKey)
  }

  const host = requireHost()
  // The props go in as well as being applied below, because a few of them
  // decide what the host BUILDS rather than how the built element behaves —
  // `input multiline` becomes a different control entirely, and no target can
  // swap one for the other after the fact. Hosts with nothing to read here
  // ignore the argument.
  const element = host.createElement(tag, props)
  let ref: ((element: HostElement) => void) | undefined

  for (const [name, value] of Object.entries(props)) {
    if (name === 'children') {
      appendChildren(element, value as MiniChildren)
    } else if (name === 'key') {
      // Reserved by JSX syntax; keying belongs to `list`, so ignore it here.
    } else if (name === 'ref') {
      // Deferred until the element is fully built, so the callback never sees
      // a half-populated node.
      ref = value as (element: HostElement) => void
    } else {
      applyProp(element, name, value)
    }
  }

  ref?.(element)
  scheduleFlush()
  return element
}

/**
 * The multi-children variant. The automatic runtime calls this when an element
 * has several children, and `jsx` already handles arrays, so it is the same
 * function.
 */
export const jsxs = jsx

/**
 * The development-runtime variant. Its extra debug parameters — source
 * location, `this` — have nothing to attach to in a framework with no component
 * instances, so they are accepted and dropped.
 */
export const jsxDEV = (
  tag: ElementTag | Component<never>,
  props: ElementPropBag,
  key?: unknown,
  _isStatic?: boolean,
  _source?: unknown,
  _self?: unknown,
): HostElement => jsx(tag, props, key)

/**
 * The JSX type surface TypeScript resolves from this module.
 *
 * A JSX expression IS the host element it creates, which is why one can be
 * passed anywhere the runtime expects a node and why components need no
 * wrapper type. The intrinsic set is the platform-neutral element vocabulary
 * rather than HTML — see `elements.ts` for why that inversion matters.
 */
export namespace JSX {
  export type Element = HostElement
  export type IntrinsicElements = {
    [Tag in ElementTag]: ElementProps<Tag>
  }
  export type ElementChildrenAttribute = {
    children: MiniChildren
  }
}
