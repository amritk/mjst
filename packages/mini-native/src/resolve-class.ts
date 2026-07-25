import type { ClassValue } from './types'

/**
 * Collapses a {@link ClassValue} — a string, an array, or a toggle map — into
 * the single space-joined string every host receives.
 *
 * Resolving here rather than in each host means the three input forms are
 * defined once and cannot drift between targets, and a host that has no class
 * concept only has to deal with a plain string.
 *
 * Arrays resolve their entries recursively, so nesting composes instead of
 * stringifying: `['card', shared]` where `shared` is itself an array or a toggle
 * map produces the flattened list, not the comma-joined mess `String()` would
 * make of it. That matters because building class lists from shared fragments
 * is the ordinary way people use this.
 */
export const resolveClass = (value: unknown): string => {
  if (Array.isArray(value)) return value.map(resolveClass).filter(Boolean).join(' ')
  if (value !== null && typeof value === 'object') {
    return Object.entries(value)
      .filter(([, on]) => on)
      .map(([name]) => name)
      .join(' ')
  }
  // Every falsy value drops out, not just the three the type permits. `0` and
  // `NaN` are reachable from untyped input — `count && 'badge'` hands one
  // straight through — and stringifying first would turn them into the perfectly
  // truthy class names "0" and "NaN".
  return value ? String(value) : ''
}
