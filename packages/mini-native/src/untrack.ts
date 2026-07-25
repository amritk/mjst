import { runDetached } from './run-detached'

/**
 * Reads `get` without subscribing to anything it touches — the escape hatch for
 * an effect that needs a value but must not re-run when that value changes.
 *
 * The classic case is a handler or effect that reacts to one thing while
 * consulting another: an effect that should re-run when `query` changes, but
 * which also reads the current page size to build the request, would otherwise
 * pick up a dependency on the page size and fire on every change to it.
 * Wrapping that second read in `untrack` says so explicitly.
 *
 * This is the same suspension {@link runDetached} performs, named for the other
 * side of it. `runDetached` is about OWNERSHIP — what the scopes created inside
 * belong to — and is how `list` and `renderChild` keep a subtree alive across a
 * re-run. `untrack` is about DEPENDENCIES — what the surrounding effect
 * subscribes to. One mechanism, two reasons to reach for it, so both names
 * exist and each documents its own intent.
 *
 * @example
 * ```ts
 * effect(() => {
 *   // Re-runs when `query` changes, but not when `pageSize` does.
 *   search(query(), untrack(() => pageSize()))
 * })
 * ```
 */
export const untrack = <T>(get: () => T): T => runDetached(get)
