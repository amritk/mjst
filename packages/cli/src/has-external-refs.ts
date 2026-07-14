/** The reference keywords whose value may point at another document (a non-`#` target). */
const REF_KEYWORDS = ['$ref', '$dynamicRef', '$recursiveRef'] as const

/**
 * Whether `data` contains a reference into another document (a `$ref` value that
 * is not a same-document `#...` fragment). Same-document references resolve
 * without a disk round-trip, so callers can skip the file-backed resolver — and
 * preserve behavior that depends on those internal refs — unless an external
 * (cross-file or remote) target exists.
 */
export const hasExternalRefs = (data: unknown): boolean => {
  if (data === null || typeof data !== 'object') return false
  if (Array.isArray(data)) return data.some(hasExternalRefs)
  const obj = data as Record<string, unknown>
  for (const keyword of REF_KEYWORDS) {
    const value = obj[keyword]
    if (typeof value === 'string' && !value.startsWith('#')) return true
  }
  return Object.values(obj).some(hasExternalRefs)
}
