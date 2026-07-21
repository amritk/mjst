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
 */
export const renderChild = (host: Element, select: () => ChildFactory | null): (() => void) => {
  let dispose: (() => void) | null = null
  const stop = effect(() => {
    const factory = select()
    // Tear down the branch we are replacing before building the next one.
    dispose?.()
    // effectScope runs its body synchronously; the assignment is definite,
    // just invisible to the compiler — hence the non-null assertion.
    let node: Node | null = null
    dispose = effectScope(() => {
      node = factory ? factory() : null
    })
    host.replaceChildren(...(node ? [node] : []))
  })
  return () => {
    stop()
    dispose?.()
  }
}
