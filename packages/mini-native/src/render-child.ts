import { effect, effectScope } from 'alien-signals'

import { requireHost, scheduleFlush } from './current-host'
import { onCleanup } from './on-cleanup'
import { runDetached } from './run-detached'
import type { Dispose, HostElement } from './types'

/** Builds the node to display, or returns `null` to display nothing. */
export type ChildFactory = () => HostElement | null

/**
 * Keeps `wrapper`'s children equal to whatever `select` currently resolves to —
 * the reactive single-slot swap every control-flow component is built on.
 *
 * `select` runs inside the tracking effect, so the swap re-runs whenever the
 * signals it reads change. The chosen factory then builds its subtree inside a
 * fresh `effectScope`, and that scope is disposed before the next swap and on
 * teardown — so a branch that leaves the tree also stops reacting, the same
 * per-subtree lifetime guarantee `list` gives each row.
 *
 * Branch scopes are built detached and disposed by hand rather than being left
 * to the effect that created them. alien-signals tears a scope down when the
 * effect enclosing it re-runs, which would make branch teardown a side effect of
 * the swap rather than something this function controls — and would leave the
 * final branch alive after the enclosing component unmounted. Owning the
 * lifetime outright makes both cases explicit. See `run-detached.ts`.
 */
export const renderChild = (wrapper: HostElement, select: () => ChildFactory | null): Dispose => {
  const host = requireHost()
  let dispose: Dispose | null = null

  const stop = effect(() => {
    const factory = select()
    // Tear the branch being replaced down before building the next one.
    dispose?.()
    // effectScope runs its body synchronously, so the assignment is definite —
    // just invisible to the compiler, hence the initialiser plus reassignment.
    let node: HostElement | null = null
    // Detached for the same reason `list` detaches its rows: a scope built
    // inside this effect would be disposed on the effect's next run, leaving
    // teardown order dependent on that rather than on the explicit dispose
    // above. Owning the branch outright keeps the lifetime obvious.
    dispose = runDetached(() =>
      effectScope(() => {
        node = factory ? factory() : null
      }),
    )
    host.clear(wrapper)
    if (node) host.insert(wrapper, node, null)
    scheduleFlush()
  })

  const tearDown = (): void => {
    stop()
    dispose?.()
    dispose = null
  }

  // The branch scope is detached from the swapping effect, so the enclosing
  // scope has to be told about it explicitly — otherwise a component unmounting
  // would leave its last-rendered branch still reacting.
  onCleanup(tearDown)

  return tearDown
}
