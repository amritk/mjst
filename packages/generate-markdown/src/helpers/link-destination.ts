/**
 * Characters a markdown link destination can carry unencoded. Everything else
 * is percent-encoded, which is both what makes the link work and what keeps it
 * contained: a page file with a space in it (`my docs (v2).md`) stopped being a
 * link at all, and one containing `)` closed the destination early — the text
 * after it became a second, schema-chosen link in the middle of the table.
 *
 * Page files come from `x-doc.pages[].file`, so they are input like everything
 * else here.
 */
const SAFE = /[A-Za-z0-9\-._~!$&'*+,;=:@/#?]/

/**
 * Percent-encodes one character. `encodeURIComponent` is not enough on its own:
 * it deliberately leaves `!'()*` alone, and an unbalanced `)` is exactly what
 * closes a link destination early.
 */
const percentEncode = (character: string): string =>
  [...new TextEncoder().encode(character)]
    .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`)
    .join('')

/** Percent-encodes a generated page path for use as a markdown link destination. */
export const linkDestination = (path: string): string =>
  [...path].map((character) => (SAFE.test(character) ? character : percentEncode(character))).join('')
