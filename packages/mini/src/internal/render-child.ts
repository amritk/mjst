import { computed, effect, effectScope } from 'alien-signals'

/** Builds the node to display, or returns `null` to display nothing. */
export type ChildFactory = () => Node | null

/**
 * Keeps `host`'s children equal to whatever `select` currently resolves to —
 * the reactive single-slot swap every flow component is built on.
 *
 * The swap must fire only when `select` picks a *different* factory, not on every
 * signal it happens to read. A derived condition can change without changing
 * which branch wins — `Show when={() => count() > 5}` re-evaluates on every
 * `count` tick yet stays on the same branch from 6 to 7 — and rebuilding then
 * would dispose the branch's scope (firing its `onCleanup`s) and
 * `replaceChildren` the same node back in, blurring a focused input and losing
 * scroll/selection in a subtree that did not logically change.
 *
 * So `select` runs inside a `computed`, which dedupes on the returned factory:
 * the swap effect subscribes to that computed and re-runs only when the factory
 * reference actually changes. Crucially, this also keeps the mounted branch's
 * own bindings alive across an unchanged selection. alien-signals disposes an
 * effect's child scopes when that effect re-runs, so gating with an early
 * `return` inside the effect would leave the branch scope disposed but not
 * rebuilt — its bindings would silently stop reacting. Not re-running the effect
 * at all is what avoids that: the branch scope is only ever torn down on a real
 * flip, right before the next one is built.
 *
 * The previous scope is disposed explicitly at the top of each run rather than
 * through an effect-cleanup return: scopes created inside an effect persist
 * across its re-runs, so they must be torn down by hand.
 */
export const renderChild = (host: Element, select: () => ChildFactory | null): (() => void) => {
  let dispose: (() => void) | null = null
  // The selection, memoised on the factory reference. The effect below tracks
  // this computed, so it re-runs only when the chosen factory changes — never on
  // an unrelated signal the condition happens to read.
  const selected = computed(select)
  const stop = effect(() => {
    const factory = selected()
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
