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
 */
export const list = <T>(
  container: Element,
  items: () => readonly T[],
  key: (item: T) => string,
  create: (item: T) => HTMLElement,
): (() => void) => {
  const live = new Map<string, { node: HTMLElement; dispose: () => void }>()

  const stop = effect(() => {
    const next = items()
    const seen = new Set<string>()
    let cursor: ChildNode | null = container.firstChild
    for (const item of next) {
      const k = key(item)
      seen.add(k)
      let entry = live.get(k)
      if (!entry) {
        // effectScope runs its body synchronously; the assignment inside is
        // definite, just invisible to the compiler — hence the non-null `!`.
        let node!: HTMLElement
        const dispose = effectScope(() => {
          node = create(item)
        })
        entry = { node, dispose }
        live.set(k, entry)
      }
      if (entry.node === cursor) cursor = cursor.nextSibling
      else container.insertBefore(entry.node, cursor)
    }
    for (const [k, entry] of live) {
      if (seen.has(k)) continue
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
