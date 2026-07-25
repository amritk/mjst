import { effect, effectScope } from 'alien-signals'

import { requireHost, scheduleFlush } from './current-host'
import type { Host } from './host'
import { onCleanup } from './on-cleanup'
import { runDetached } from './run-detached'
import type { Dispose, HostElement, HostNode } from './types'
import { warn } from './warn'

/** A live row: the node it built and the dispose for the scope its bindings live in. */
type Entry = {
  node: HostElement
  dispose: Dispose
}

/**
 * Keyed reactive list: keeps `container`'s children in sync with `items`,
 * building a node per new key and disposing the ones whose key disappears.
 *
 * This is the only place in the framework that reconciles anything, and it
 * needs just four host operations — `insert`, `remove`, `clear`, and
 * `nextSibling` — which is why it ports to any target unchanged.
 *
 * Each row is built inside its own `effectScope`, so the bindings a row creates
 * are torn down together with the row itself. Without that, a removed row's
 * effects would keep running against a node nobody can see.
 *
 * Reconciliation is **keyed and move-minimal**: a node is only touched when the
 * update genuinely changes its position, and node identity is preserved
 * throughout, so a moved row keeps its focus and input state. That matters more
 * here than it does on the web — every move is a call across the bridge to the
 * platform, so a reconciler that reshuffles rows it did not need to touch is
 * paying real money for it. Appending, replacing the tail, swapping a pair, and
 * removing from the middle all cost zero moves; a genuine move costs one insert.
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
  const live = new Map<string, Entry>()
  // The key order rendered on the previous pass, in tree order — the old
  // sequence the diff walks against. Rebuilt from the new order every pass.
  let prev: string[] = []

  const stop = effect(() => {
    const next = items()

    // Pass 1 — materialise the new key order and make sure a node exists for
    // every key in it. A brand-new key is built here, in its own scope, but not
    // placed; the diff below decides where it goes.
    const order: string[] = []
    const seen = new Set<string>()
    let index = 0
    for (const item of next) {
      const k = key(item, index)
      if (seen.has(k)) {
        // Two items claiming one identity cannot both be rendered, and quietly
        // collapsing them onto a single row looks exactly like data going
        // missing. Say so, then drop the row. `indexKey` is the way out when a
        // collection of primitives can legitimately repeat.
        warn('list: duplicate key drops rows:', k)
        index++
        continue
      }
      seen.add(k)
      if (!live.has(k)) {
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
        live.set(k, { node, dispose })
      }
      order.push(k)
      index++
    }

    // Pass 2 — move as few nodes as possible to get from `prev` to `order`.
    reconcile(host, container, prev, order, live)
    prev = order

    scheduleFlush()
  })

  // Clearing `live` as it goes makes this safe to call twice, which matters
  // because both an explicit call and scope teardown can reach it.
  const dispose = (): void => {
    stop()
    for (const entry of live.values()) entry.dispose()
    live.clear()
    prev = []
  }

  // Row scopes are detached from the reconciliation effect, so nothing tears
  // them down on their own. Tying them to the scope `list` was called in — the
  // component's — means unmounting the component still disposes every row.
  onCleanup(dispose)

  return dispose
}

/** The node currently bound to `k`, which pass 1 guarantees is present. */
const nodeOf = (live: Map<string, Entry>, k: string): HostElement => (live.get(k) as Entry).node

/** Disposes a key's scope, detaches its node, and forgets it. */
const drop = (host: Host, live: Map<string, Entry>, k: string): void => {
  const entry = live.get(k)
  if (!entry) return
  entry.dispose()
  host.remove(entry.node)
  live.delete(k)
}

/**
 * Reorders `container`'s children from key order `a` to key order `b` with the
 * fewest moves, disposing the keys that leave.
 *
 * This is the two-ended keyed diff (Vue 2 / Snabbdom), specialised to the
 * key→node map this module already keeps: four pointers close in from both
 * ends, so a matching head or tail costs a pointer step and no tree work at
 * all, and the two cross cases catch a row that slid to the opposite end in a
 * single move. Only when none of the four ends line up does it build a
 * key→old-index map and place the wanted head row directly.
 *
 * The naive alternative — walk the new order with a cursor and insert anything
 * not already sitting there — is much shorter but degrades badly on the two
 * edits users perform most: removing an item from the middle re-inserts every
 * row after it, and moving the first row to the end re-inserts everything. On a
 * native target that is a bridge call per row for an edit that should have cost
 * none.
 *
 * Every node in `b` already exists in `live`; this only applies positions and
 * removes the keys absent from `b`. `a` is the discarded previous order and is
 * mutated (slots vacated by a move are nulled so later steps skip them); `b` is
 * the caller's kept order and is never touched.
 */
const reconcile = (
  host: Host,
  container: HostElement,
  a: (string | null)[],
  b: readonly string[],
  live: Map<string, Entry>,
): void => {
  if (b.length === 0) {
    // Full clear: the container holds only this list's nodes, so tear down every
    // scope and empty it in one host call rather than detaching row by row.
    for (const entry of live.values()) entry.dispose()
    live.clear()
    host.clear(container)
    return
  }

  let aStart = 0
  let aEnd = a.length - 1
  let bStart = 0
  let bEnd = b.length - 1
  // The four end keys, re-read as the pointers step. Every read happens under
  // the `aStart <= aEnd` / `bStart <= bEnd` loop guard, so the index is in
  // range — the `?? null` and `as string` only satisfy the checker, which
  // cannot prove it. An old-side key may be `null` (a slot vacated by a move);
  // a new-side key never is.
  let aStartKey: string | null = a[aStart] ?? null
  let aEndKey: string | null = a[aEnd] ?? null
  let bStartKey = b[bStart] as string
  let bEndKey = b[bEnd] as string
  // Built lazily the first time no end lines up — the only case that needs it.
  let oldIndex: Map<string, number> | undefined

  while (aStart <= aEnd && bStart <= bEnd) {
    if (aStartKey === null) aStartKey = a[++aStart] ?? null
    else if (aEndKey === null) aEndKey = a[--aEnd] ?? null
    else if (aStartKey === bStartKey) {
      aStartKey = a[++aStart] ?? null
      bStartKey = b[++bStart] as string
    } else if (aEndKey === bEndKey) {
      aEndKey = a[--aEnd] ?? null
      bEndKey = b[--bEnd] as string
    } else if (aStartKey === bEndKey) {
      // Head of old is now the tail of new: it slid right. Park it after the
      // current old tail, which is where that new-tail slot sits.
      host.insert(container, nodeOf(live, aStartKey), host.nextSibling(nodeOf(live, aEndKey)))
      aStartKey = a[++aStart] ?? null
      bEndKey = b[--bEnd] as string
    } else if (aEndKey === bStartKey) {
      // Tail of old is now the head of new: it slid left. Move it before the
      // current old head.
      host.insert(container, nodeOf(live, aEndKey), nodeOf(live, aStartKey))
      aEndKey = a[--aEnd] ?? null
      bStartKey = b[++bStart] as string
    } else {
      if (oldIndex === undefined) {
        oldIndex = new Map()
        for (let i = aStart; i <= aEnd; i++) {
          const k = a[i]
          if (k != null) oldIndex.set(k, i)
        }
      }
      const found = oldIndex.get(bStartKey)
      // Place the wanted head row before the current old head. If it already
      // existed elsewhere, null its old slot so the pointer walk skips it;
      // otherwise it is a brand-new node dropped straight into position.
      host.insert(container, nodeOf(live, bStartKey), nodeOf(live, aStartKey))
      if (found !== undefined) a[found] = null
      bStartKey = b[++bStart] as string
    }
  }

  if (aStart > aEnd) {
    // Old exhausted — whatever is left of the new order is insertions, anchored
    // before the first already-placed node past the range (a null anchor
    // appends).
    if (bStart <= bEnd) {
      const anchor: HostNode | null = bEnd + 1 < b.length ? nodeOf(live, b[bEnd + 1] as string) : null
      for (; bStart <= bEnd; bStart++) host.insert(container, nodeOf(live, b[bStart] as string), anchor)
    }
  } else if (bStart > bEnd) {
    // New exhausted — whatever is left of the old order is removals.
    for (; aStart <= aEnd; aStart++) {
      const k = a[aStart]
      if (k != null) drop(host, live, k)
    }
  }
}
