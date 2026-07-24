import { effect, effectScope } from 'alien-signals'

/**
 * Keyed reactive list: keeps `container`'s children in sync with `items`,
 * creating a node per new key and disposing removed ones. Each item's node is
 * built inside its own `effectScope`, so bindings created in `create` are
 * torn down with the node.
 *
 * The container must be owned exclusively by this list — reconciliation
 * assumes every child was created here.
 *
 * Reconciliation is append-order: existing nodes that are already in position
 * are left untouched, so append-only and replace-the-tail updates (all a chat
 * transcript does) never move DOM. Arbitrary reorders still converge via
 * insertBefore, just less efficiently — if a reordering UI ever appears, this
 * is the function to revisit.
 *
 * Returns a dispose function that stops tracking and tears down every item
 * scope (without removing the container itself).
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
  const live = new Map<string, { node: HTMLElement; dispose: () => void; seen: number }>()
  // A monotonic pass counter stamped onto each entry marks which keys the
  // current reconcile touched — the survivor set, without allocating a fresh
  // `Set` (and N inserts) on every update. Entries left on an older pass number
  // are the removals; an entry already stamped with the current pass is a
  // duplicate key.
  let pass = 0

  const stop = effect(() => {
    const next = items()
    const now = ++pass
    let cursor: ChildNode | null = container.firstChild
    // The position is tracked here so `key`/`create` receive it directly —
    // deriving it with `items().indexOf(item)` at each call site would be O(n²)
    // and mis-handle duplicate primitives (indexOf finds the first match).
    let index = 0
    for (const item of next) {
      const k = key(item, index)
      let entry = live.get(k)
      if (!entry) {
        // effectScope runs its body synchronously; the assignment inside is
        // definite, just invisible to the compiler — hence the non-null `!`.
        let node!: HTMLElement
        const created = index
        const dispose = effectScope(() => {
          node = create(item, created)
        })
        entry = { node, dispose, seen: now }
        live.set(k, entry)
      } else {
        // Two items with the same key collapse into one node — the second shares
        // the first's element and its own row silently vanishes. An entry already
        // stamped with this pass means we visited its key earlier in the same
        // reconcile, so surface it rather than dropping rows without a trace.
        if (entry.seen === now) console.warn('[mini] list: duplicate key drops rows:', k)
        entry.seen = now
      }
      if (entry.node === cursor) cursor = cursor.nextSibling
      else container.insertBefore(entry.node, cursor)
      index++
    }
    for (const [k, entry] of live) {
      if (entry.seen === now) continue
      entry.dispose()
      entry.node.remove()
      live.delete(k)
    }
  })

  return () => {
    stop()
    for (const entry of live.values()) entry.dispose()
    live.clear()
  }
}
