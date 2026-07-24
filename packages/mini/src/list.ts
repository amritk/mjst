import { effect, effectScope } from 'alien-signals'

/** A live row: its DOM node and the dispose for the scope its bindings live in. */
type Entry = { node: HTMLElement; dispose: () => void }

/**
 * Keyed reactive list: keeps `container`'s children in sync with `items`,
 * creating a node per new key and disposing removed ones. Each item's node is
 * built inside its own `effectScope`, so bindings created in `create` are torn
 * down with the node.
 *
 * The container must be owned exclusively by this list — reconciliation assumes
 * every child was created here.
 *
 * Reconciliation is **keyed and move-minimal**: a node is only touched when the
 * update actually changes its position. A two-ended pass walks the old and new
 * orders inward from both ends at once, so the common cases fall out in zero
 * moves — appending or replacing the tail (all a chat transcript does) advances
 * the head pointers and never moves DOM, and a removal in the middle just
 * disposes that one node. When a row genuinely moves it is repositioned with a
 * single `insertBefore`: swapping two rows is two moves, reversing is one move
 * per row. Node identity is preserved throughout, so a moved row keeps its
 * focus, scroll, and input state.
 *
 * Returns a dispose function that stops tracking and tears down every item scope
 * (without removing the container itself).
 *
 * @example
 * ```tsx
 * const todos = signal<{ id: string; text: string }[]>([])
 * const ul = (<ul />) as HTMLUListElement
 * // items is a getter (pass the signal); key must be stable per item.
 * list(ul, todos, (todo) => todo.id, (todo) => <li>{todo.text}</li>)
 * todos([...todos(), { id: '1', text: 'ship docs' }]) // appends one <li>
 * ```
 */
export const list = <T>(
  container: Element,
  items: () => readonly T[],
  key: (item: T, index: number) => string,
  create: (item: T, index: number) => HTMLElement,
): (() => void) => {
  const live = new Map<string, Entry>()
  // The key order rendered on the previous pass, in DOM order — the old sequence
  // the diff walks against. Rebuilt from the new order at the end of every pass.
  let prev: string[] = []

  const stop = effect(() => {
    const next = items()

    // Pass 1 — materialise the new key order and make sure a node exists for
    // every key in it. A brand-new key is built here (in its own scope) but not
    // placed; the diff decides where it goes. Duplicate keys collapse onto the
    // first node and drop their row, with a warning so the collision is visible.
    const order: string[] = []
    const seen = new Set<string>()
    let index = 0
    for (const item of next) {
      const k = key(item, index)
      if (seen.has(k)) {
        console.warn('[mini] list: duplicate key drops rows:', k)
        index++
        continue
      }
      seen.add(k)
      if (!live.has(k)) {
        // effectScope runs its body synchronously; the assignment inside is
        // definite, just invisible to the compiler — hence the non-null `!`.
        let node!: HTMLElement
        const created = index
        const dispose = effectScope(() => {
          node = create(item, created)
        })
        live.set(k, { node, dispose })
      }
      order.push(k)
      index++
    }

    // Pass 2 — reconcile the DOM to `order`, moving as few nodes as possible.
    reconcile(container, prev, order, live)
    prev = order
  })

  return () => {
    stop()
    for (const entry of live.values()) entry.dispose()
    live.clear()
  }
}

/** The DOM node currently bound to `k` (guaranteed present after pass 1). */
const nodeOf = (live: Map<string, Entry>, k: string): HTMLElement => (live.get(k) as Entry).node

/** Dispose a key's scope, remove its node, and forget it. */
const drop = (live: Map<string, Entry>, k: string): void => {
  const entry = live.get(k)
  if (!entry) return
  entry.dispose()
  entry.node.remove()
  live.delete(k)
}

/**
 * Reorder `container`'s children from key order `a` to key order `b` with the
 * fewest DOM moves, disposing keys that leave. This is the two-ended keyed diff
 * (Vue 2 / Snabbdom), specialised to mini's key→node map: four pointers close in
 * from both ends, so a matching head or tail costs a pointer step and no DOM
 * work, and the cross cases catch rows that slid to the other end in one move
 * each. Only when none of the four ends line up does it consult a key→old-index
 * map to place the head row directly. All of `b`'s nodes already exist in
 * `live`; this applies their positions and removes keys absent from `b`.
 *
 * `a` is the discarded previous order and is mutated (moved-out slots are nulled
 * so later passes skip them); `b` is the caller's kept order and is never
 * touched.
 */
const reconcile = (container: Element, a: (string | null)[], b: readonly string[], live: Map<string, Entry>): void => {
  let aStart = 0
  let aEnd = a.length - 1
  let bStart = 0
  let bEnd = b.length - 1
  // The four end keys, re-read from the arrays as the pointers step. Every read
  // happens under the `aStart <= aEnd`/`bStart <= bEnd` loop guard, so the index
  // is in range — the `?? null` / `as string` only satisfy the checker, which
  // can't prove it. An old-side key may be `null` (a slot vacated by a move); a
  // new-side key never is.
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
      // current old tail, where that new-tail slot sits.
      container.insertBefore(nodeOf(live, aStartKey), nodeOf(live, aEndKey).nextSibling)
      aStartKey = a[++aStart] ?? null
      bEndKey = b[--bEnd] as string
    } else if (aEndKey === bStartKey) {
      // Tail of old is now the head of new: it slid left. Move it before the
      // current old head.
      container.insertBefore(nodeOf(live, aEndKey), nodeOf(live, aStartKey))
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
      // otherwise it is a brand-new node dropped into position.
      container.insertBefore(nodeOf(live, bStartKey), nodeOf(live, aStartKey))
      if (found !== undefined) a[found] = null
      bStartKey = b[++bStart] as string
    }
  }

  if (aStart > aEnd) {
    // Old exhausted — the leftover new keys are insertions before the first
    // already-placed node past the range (null anchor = append).
    const anchor = bEnd + 1 < b.length ? nodeOf(live, b[bEnd + 1] as string) : null
    for (; bStart <= bEnd; bStart++) container.insertBefore(nodeOf(live, b[bStart] as string), anchor)
  } else if (bStart > bEnd) {
    // New exhausted — the leftover old keys are removals.
    for (; aStart <= aEnd; aStart++) {
      const k = a[aStart]
      if (k != null) drop(live, k)
    }
  }
}
