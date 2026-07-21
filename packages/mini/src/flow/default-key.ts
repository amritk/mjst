/**
 * The key {@link For} uses when the caller does not supply one.
 *
 * It prefers a stable identity — an object's `id`, or a primitive item's own
 * value — and falls back to the position index only when nothing better exists.
 * The index fallback is a correctness hazard for reordering lists (two items
 * swapping positions would swap identities), which is exactly why `For` accepts
 * an explicit `key`: pass one whenever the collection can reorder.
 */
export const defaultKey = (item: unknown, index: number): string => {
  if (item !== null && typeof item === 'object' && 'id' in item) {
    const id = (item as { id: unknown }).id
    if (typeof id === 'string' || typeof id === 'number') return String(id)
  }
  if (typeof item === 'string' || typeof item === 'number') return String(item)
  return String(index)
}
