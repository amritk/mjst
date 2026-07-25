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
 * The value forms `class` accepts. A plain string is applied verbatim, an array
 * drops falsy entries and joins with spaces (`['card', active && 'on']`), and
 * an object keeps the keys whose value is truthy (`{ card: true, on: active() }`).
 * The whole thing is still `MaybeReactive`, so wrap it in a getter to track it.
 *
 * Hosts that have no class concept at all are free to ignore the resolved
 * string; the runtime always hands them a plain space-joined value.
 */
export type ClassValue = string | readonly (string | false | null | undefined)[] | Record<string, boolean>

/**
 * A style declaration as a property bag. Unlike the web there is no `cssText`
 * string form here, because a native host has no CSS parser to hand a string
 * to — a structured object is the only shape every target can consume.
 *
 * Keys may be camelCase or kebab-case; the DOM host normalises them and native
 * hosts generally want the camelCase form as-is. Numbers are passed through
 * untouched, so add units yourself wherever the target needs them.
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
