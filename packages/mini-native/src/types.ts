/**
 * The value shapes shared by the runtime, the host contract, and the JSX
 * types. These are deliberately free of any platform types — nothing here
 * mentions the DOM, which is what lets the same runtime drive a browser, a
 * native view tree, or a headless test tree.
 */

/** Tears something down. Every subscription in this package returns one. */
export type Dispose = () => void

/**
 * A prop value that may be static or a reactive getter. A signal satisfies the
 * getter arm as-is (it is a zero-argument function), so `disabled={busy}`
 * typechecks and binds live while `disabled={true}` typechecks and is static.
 *
 * This is the whole reactivity rule of a compilerless JSX: there is no compiler
 * analysing expressions, so reactivity is decided by the SHAPE of the value at
 * runtime. A function tracks, anything else is applied once.
 */
export type MaybeReactive<T> = T | (() => T)

/** A child rendered once at creation. Functions are handled separately as reactive text. */
type StaticChild = HostChild | string | number | boolean | null | undefined

/**
 * Anything that may appear between an element's tags. A function child becomes
 * a reactive text node bound to whatever signals it reads.
 */
export type MiniChild = StaticChild | (() => string | number | boolean | null | undefined)

export type MiniChildren = MiniChild | readonly MiniChild[]

/**
 * What may appear inside a CONTAINER element — anything already built into a
 * host node, plus the nullish and boolean values that vanish, which is what
 * keeps `{condition && <text>…</text>}` working as a build-time conditional.
 *
 * Bare strings and numbers are deliberately absent, and that is the whole point
 * of the type existing. A native view tree has no notion of loose text inside a
 * container: on Lynx a text run has to live inside a `<text>` element, so
 * `<view>hello</view>` builds a node the engine will not render and the screen
 * comes up silently blank. The DOM host would happily show it, which is exactly
 * how that mistake survives a browser preview and reaches a device. Making it a
 * compile error is the only place to catch it honestly.
 */
export type ContainerChild = HostChild | boolean | null | undefined

export type ContainerChildren = ContainerChild | readonly ContainerChild[]

/**
 * The value forms `class` accepts. A plain string is applied verbatim, an array
 * drops falsy entries and joins with spaces (`['card', active && 'on']`), and
 * an object keeps the keys whose value is truthy (`{ card: true, on: active() }`).
 * The whole thing is still `MaybeReactive`, so wrap it in a getter to track it.
 *
 * The array arm is recursive, so a shared fragment can be dropped into a list
 * without being flattened by hand first — `['card', theme]` composes whether
 * `theme` is a string, another array, or a toggle map.
 *
 * Hosts that have no class concept at all are free to ignore the resolved
 * string; the runtime always hands them a plain space-joined value.
 */
export type ClassValue = string | false | null | undefined | readonly ClassValue[] | Record<string, boolean>

/**
 * A style declaration as a property bag. Unlike the web there is no `cssText`
 * string form here, because a native host has no CSS parser to hand a string
 * to — a structured object is the only shape every target can consume.
 *
 * Keys may be camelCase or kebab-case; the DOM host normalises them and native
 * hosts generally want the camelCase form as-is.
 *
 * A bare NUMBER means density-independent pixels, the convention React Native
 * and every native toolkit share, and the host adds the unit — so
 * `{ width: 100 }` is a hundred pixels on every target rather than an invalid
 * declaration the browser silently discards. Pass a string when you want a
 * different unit (`'50%'`, `'2rem'`), and note that the properties CSS treats
 * as unitless stay unitless.
 */
export type StyleValue = Record<string, string | number | null | undefined | false>

/**
 * A component: a plain function, run exactly once, returning its root element.
 * There is no instance, no lifecycle, and no re-render — whatever reactivity
 * the component sets up internally is the only thing that ever updates after.
 */
export type Component<P> = (props: P) => HostElement

/**
 * An opaque handle to an element in the host tree. The runtime never inspects
 * one; it only ever hands it back to the host that made it. Each host adapter
 * casts its own concrete type (an `HTMLElement`, a Lynx element, a plain
 * object) across this boundary exactly once, inside the adapter.
 */
declare const hostElementBrand: unique symbol
export type HostElement = { readonly [hostElementBrand]: true }

/** An opaque handle to a text node in the host tree. See {@link HostElement}. */
declare const hostTextBrand: unique symbol
export type HostText = { readonly [hostTextBrand]: true }

/** Either kind of node. Insertion and removal accept both. */
export type HostNode = HostElement | HostText

/**
 * A child that is already a host node. Split out from {@link MiniChild} so the
 * child union can name it before `HostElement` is declared below it.
 */
type HostChild = HostNode
