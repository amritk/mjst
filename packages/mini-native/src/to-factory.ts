import type { HostElement } from './types'

/**
 * Normalises a branch — an already-built element or a function that builds one
 * — into a factory the control-flow components can call on entry.
 *
 * The two forms behave differently on purpose, and the difference is worth
 * knowing before picking one:
 *
 * - A FUNCTION is lazy. Nothing is built until the branch is first entered, and
 *   it is rebuilt fresh on every re-entry. Any state inside it resets each time.
 * - An ALREADY-BUILT ELEMENT is eager. It is constructed once, up front, even if
 *   the branch never shows, and the same node is reattached on every re-entry,
 *   so state inside it survives being hidden.
 *
 * Reach for the function form by default; reach for the element form when a
 * branch is expensive to rebuild or has state worth preserving.
 */
export const toFactory = (branch: HostElement | (() => HostElement)): (() => HostElement) =>
  typeof branch === 'function' ? branch : () => branch
