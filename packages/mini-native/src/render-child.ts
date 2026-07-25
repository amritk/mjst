import { computed, effect, effectScope } from 'alien-signals'

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
 * The swap must fire only when `select` picks a DIFFERENT factory, never merely
 * because a signal it read changed. Those are not the same thing, and treating
 * them as one is expensive: `<Show when={user}>` re-evaluates whenever `user`
 * changes but stays on the same branch for any non-null user, and
 * `<Show when={() => count() > 5}>` re-evaluates on every tick yet stays on the
 * same branch from 6 to 7. Rebuilding then would dispose the branch's scope
 * (firing its `onCleanup` callbacks) and construct the whole subtree again for
 * a change that selected nothing new — losing focus, scroll position, and text
 * selection inside a subtree that did not logically change, and paying a full
 * teardown-and-rebuild across the bridge on a native target.
 *
 * So `select` runs inside a `computed`, which dedupes on the returned factory
 * reference: the swap effect subscribes to that computed and re-runs only when
 * the chosen factory actually changes. It follows that the branch factories
 * themselves have to be STABLE references — the control-flow components build
 * theirs once, up front, precisely so this check can do its job.
 *
 * The chosen factory then builds its subtree inside a fresh `effectScope`, and
 * that scope is disposed before the next swap and on teardown — so a branch
 * that leaves the tree also stops reacting, the same per-subtree lifetime
 * guarantee `list` gives each row.
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

  // The selection, memoised on the factory reference. The effect below tracks
  // this rather than `select` itself, so an unrelated signal the condition
  // happens to read cannot force a rebuild.
  const selected = computed(select)

  const stop = effect(() => {
    const factory = selected()
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
