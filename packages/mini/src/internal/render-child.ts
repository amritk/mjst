import { effect, effectScope } from 'alien-signals'

/** Builds the node to display, or returns `null` to display nothing. */
export type ChildFactory = () => Node | null

/**
 * Keeps `host`'s children equal to whatever `select` currently resolves to —
 * the reactive single-slot swap every flow component is built on.
 *
 * `select` runs inside the tracking effect, so the swap re-runs whenever the
 * signals it reads change. The chosen factory then builds its subtree inside a
 * fresh `effectScope`, and that scope is disposed before the next swap (and on
 * teardown), so a branch that leaves the DOM also stops reacting — the same
 * per-item lifetime guarantee `list` gives each row.
 *
 * The previous scope is disposed explicitly at the top of each run rather than
 * through an effect-cleanup return: scopes created inside an effect persist
 * across its re-runs (this is what lets `list` keep untouched rows alive), so
 * they must be torn down by hand.
 *
 * The swap is gated on factory identity. The effect re-runs whenever any signal
 * `select` reads changes, but a *derived* condition can change without changing
 * which factory wins — `Show when={() => count() > 5}` re-runs on every `count`
 * tick, yet stays on the same branch from 6 to 7. Rebuilding then would dispose
 * the branch's scope (firing its `onCleanup`s, re-running its bindings) and
 * `replaceChildren` the same node back in, blurring a focused input and losing
 * scroll/selection in a subtree that did not logically change. Skipping when the
 * factory is unchanged is what makes the reused-node form actually
 * state-preserving, and it leaves genuine branch flips (a different factory
 * reference) rebuilding exactly as before.
 */
export const renderChild = (host: Element, select: () => ChildFactory | null): (() => void) => {
  let dispose: (() => void) | null = null
  // Tracks the mounted factory so an unchanged selection can skip the rebuild.
  // `mounted` distinguishes "nothing built yet" from "last selection was null",
  // since `null` is a legitimate factory value (render nothing).
  let current: ChildFactory | null = null
  let mounted = false
  const stop = effect(() => {
    const factory = select()
    if (mounted && factory === current) return
    mounted = true
    current = factory
    // Tear down the branch we are replacing before building the next one.
    dispose?.()
    // effectScope runs its body synchronously; the assignment is definite,
    // just invisible to the compiler — hence the non-null assertion.
    let node: Node | null = null
    dispose = effectScope(() => {
      node = factory ? factory() : null
    })
    if (node) host.replaceChildren(node)
    else host.replaceChildren()
  })
  return () => {
    stop()
    dispose?.()
  }
}
