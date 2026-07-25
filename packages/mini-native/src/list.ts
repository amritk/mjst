import { effect, effectScope } from 'alien-signals'

import { requireHost, scheduleFlush } from './current-host'
import { onCleanup } from './on-cleanup'
import { runDetached } from './run-detached'
import type { Dispose, HostElement, HostNode } from './types'

/**
 * Keyed reactive list: keeps `container`'s children in sync with `items`,
 * building a node per new key and disposing the ones whose key disappears.
 *
 * This is the only place in the framework that reconciles anything, and it
 * needs just four host operations — `firstChild`, `nextSibling`, `insert`, and
 * `remove` — which is why it ports to any target unchanged.
 *
 * Each row is built inside its own `effectScope`, so the bindings a row creates
 * are torn down together with the row itself. Without that, a removed row's
 * effects would keep running against a node nobody can see.
 *
 * Reconciliation is append-ordered: rows already sitting in the right position
 * are left completely untouched, so appending and replacing-the-tail never move
 * existing nodes. Arbitrary reorders still converge, just with more insert
 * calls — worth revisiting only if a genuinely reorder-heavy screen shows up.
 *
 * The container must be owned exclusively by this list, because reconciliation
 * assumes every child it walks was created here.
 *
 * @example
 * ```tsx
 * const rows = signal<{ id: string; label: string }[]>([])
 * const box = <view /> as HostElement
 * list(box, rows, (row) => row.id, (row) => <text>{row.label}</text>)
 * ```
 */
export const list = <T>(
  container: HostElement,
  items: () => readonly T[],
  key: (item: T, index: number) => string,
  create: (item: T, index: number) => HostElement,
): Dispose => {
  const host = requireHost()
  const live = new Map<string, { node: HostElement; dispose: Dispose }>()

  const stop = effect(() => {
    const next = items()
    const seen = new Set<string>()
    let cursor: HostNode | null = host.firstChild(container)
    // The position is tracked here so `key` and `create` receive it directly.
    // Recovering it with `indexOf` at each call site would be quadratic and
    // would mis-handle duplicate primitives, since `indexOf` finds the first.
    let index = 0

    for (const item of next) {
      const k = key(item, index)
      seen.add(k)
      let entry = live.get(k)

      if (!entry) {
        // effectScope runs its body synchronously, so the assignment inside is
        // definite — just invisible to the compiler, hence the non-null claim.
        let node!: HostElement
        const created = index
        // Detached on purpose: a scope built inside this effect would be
        // disposed the next time the effect re-runs, so appending one row would
        // quietly kill the bindings of every row already rendered. See
        // `runDetached` for the full explanation.
        const dispose = runDetached(() =>
          effectScope(() => {
            node = create(item, created)
          }),
        )
        entry = { node, dispose }
        live.set(k, entry)
      }

      if (entry.node === cursor) cursor = host.nextSibling(cursor)
      else host.insert(container, entry.node, cursor)
      index++
    }

    for (const [k, entry] of live) {
      if (seen.has(k)) continue
      entry.dispose()
      host.remove(entry.node)
      live.delete(k)
    }

    scheduleFlush()
  })

  // Clearing `live` as it goes makes this safe to call twice, which matters
  // because both an explicit call and scope teardown can reach it.
  const dispose = (): void => {
    stop()
    for (const entry of live.values()) entry.dispose()
    live.clear()
  }

  // Row scopes are detached from the reconciliation effect, so nothing tears
  // them down on their own. Tying them to the scope `list` was called in — the
  // component's — means unmounting the component still disposes every row.
  onCleanup(dispose)

  return dispose
}
