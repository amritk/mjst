/**
 * One parsed `Accept` entry: its media type and quality weight. Sorting these
 * by descending `q` (stable within equal `q`, so client order breaks ties) is
 * how {@link negotiateMediaType} finds the client's preferred offer.
 */
export type AcceptEntry = {
  readonly type: string
  readonly quality: number
}

/**
 * Parses an `Accept` header into entries sorted by preference. A malformed
 * `q` falls back to `1`; a `q=0` entry stays in the list (it explicitly
 * *rejects* that type, which {@link negotiateMediaType} honors).
 */
export const parseAccept = (header: string): AcceptEntry[] => {
  const entries: AcceptEntry[] = []
  for (const part of header.split(',')) {
    const segments = part.trim().split(';')
    const type = segments[0]?.trim().toLowerCase()
    if (type === undefined || type === '') continue
    let quality = 1
    for (let index = 1; index < segments.length; index++) {
      const segment = segments[index]?.trim()
      if (segment?.startsWith('q=') === true) {
        const parsed = Number(segment.slice(2))
        quality = Number.isFinite(parsed) ? parsed : 1
      }
    }
    entries.push({ type, quality })
  }
  // Descending quality; equal quality keeps the original (client) order.
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => b.entry.quality - a.entry.quality || a.index - b.index)
    .map(({ entry }) => entry)
}

/**
 * How specifically an `Accept` entry matches an offered type: `3` exact,
 * `2` subtype-wildcard, `1` full-wildcard, `-1` no match. The most specific
 * matching entry decides an offer's fate — so `application/json;q=0` (exact)
 * overrides a full-wildcard `q=1` present in the same header, exactly as
 * RFC 9110 prescribes.
 */
const specificity = (acceptType: string, offer: string): number => {
  if (acceptType === offer) return 3
  if (acceptType === '*/*') return 1
  const slash = acceptType.indexOf('/')
  if (slash !== -1 && acceptType.endsWith('/*') && offer.startsWith(`${acceptType.slice(0, slash)}/`)) return 2
  return -1
}

/**
 * Server-driven content negotiation — the `respond_to` / FastAPI response-media
 * selection this framework did not model. Given an `Accept` header (or `null`)
 * and the media types a route can produce, returns the client's most-preferred
 * offer, or `undefined` when the client accepts none of them (answer `406`).
 * A missing/empty `Accept` means "anything", so the first offer wins. An
 * explicit `q=0` rejects a type even if a wildcard would otherwise allow it.
 *
 * @example
 * ```typescript
 * const chosen = negotiateMediaType(request.header('accept'), ['application/json', 'text/csv'])
 * if (chosen === undefined) return { status: 406, body: { error: 'not_acceptable' } }
 * ```
 */
export const negotiateMediaType = (
  acceptHeader: string | null | undefined,
  offered: readonly string[],
): string | undefined => {
  if (offered.length === 0) return undefined
  if (acceptHeader === null || acceptHeader === undefined || acceptHeader.trim() === '') return offered[0]

  const entries = parseAccept(acceptHeader)
  let best: { offer: string; quality: number } | undefined
  for (const offer of offered) {
    const lower = offer.toLowerCase()
    // The most specific matching entry sets this offer's effective quality —
    // a wildcard cannot rescue a type an exact entry explicitly refused.
    let bestSpecificity = -1
    let quality = 0
    for (const entry of entries) {
      const score = specificity(entry.type, lower)
      if (score > bestSpecificity) {
        bestSpecificity = score
        quality = entry.quality
      }
    }
    // Keep the highest-quality acceptable offer; offer order breaks ties.
    if (quality > 0 && (best === undefined || quality > best.quality)) best = { offer, quality }
  }
  return best?.offer
}
