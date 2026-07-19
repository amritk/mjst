/**
 * Whether an `if-none-match` request header matches a stored etag, for
 * answering 304 on the served OpenAPI document.
 *
 * This is deliberately a simple exact-token scan over the comma-split list
 * plus the `*` wildcard: RFC 9110 prescribes weak comparison for
 * `if-none-match`, so a `W/` prefix on a client token is stripped before the
 * compare. Etags never contain commas (ours are quoted hex), so splitting on
 * commas cannot cut a token in half.
 *
 * The compiled engine emits an inline copy of this logic (its runtime imports
 * are limited to the package's public surface) — keep the two in sync.
 */
export const matchesIfNoneMatch = (headerValue: string, etag: string): boolean => {
  if (headerValue.trim() === '*') return true
  for (const part of headerValue.split(',')) {
    let candidate = part.trim()
    if (candidate.startsWith('W/')) candidate = candidate.slice(2)
    if (candidate === etag) return true
  }
  return false
}
