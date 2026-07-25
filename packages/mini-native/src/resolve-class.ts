import type { ClassValue } from './types'

/**
 * Collapses a {@link ClassValue} — a string, an array, or a toggle map — into
 * the single space-joined string every host receives.
 *
 * Resolving here rather than in each host means the three input forms are
 * defined once and cannot drift between targets, and a host that has no class
 * concept only has to deal with a plain string.
 */
export const resolveClass = (value: unknown): string => {
  if (Array.isArray(value)) return value.filter(Boolean).join(' ')
  if (value !== null && typeof value === 'object') {
    return Object.entries(value)
      .filter(([, on]) => on)
      .map(([name]) => name)
      .join(' ')
  }
  return value === null || value === undefined || value === false ? '' : String(value)
}
