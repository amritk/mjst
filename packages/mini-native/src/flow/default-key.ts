/**
 * The key `For` uses when none is supplied.
 *
 * It prefers a stable identity carried by the item itself — a primitive value,
 * or an `id`/`key` field — and only falls back to the position when the item
 * offers nothing better. The fallback is the unsafe case: keying by position
 * means an insertion at the front renumbers everything after it, so every
 * following row is treated as changed. Pass an explicit `key` for any list that
 * can reorder or receive insertions anywhere but the end.
 */
export const defaultKey = (item: unknown, index: number): string => {
  if (item === null || item === undefined) return String(index)
  if (typeof item !== 'object') return String(item)

  const candidate = (item as { id?: unknown; key?: unknown }).id ?? (item as { key?: unknown }).key
  if (typeof candidate === 'string' || typeof candidate === 'number') return String(candidate)

  return String(index)
}
