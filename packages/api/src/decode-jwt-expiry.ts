/**
 * Base64url-decodes one JWT segment to its UTF-8 text. JWT uses the URL-safe
 * alphabet (`-`/`_`) and drops padding, neither of which `atob` accepts, so
 * both are restored first. `atob` yields a Latin-1 byte string; the bytes are
 * re-read through `TextDecoder` so non-ASCII claims survive intact.
 */
const base64UrlDecode = (segment: string): string => {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/**
 * Reads a JWT's `exp` claim and returns it as epoch **milliseconds** — the
 * expiry clock {@link createTokenRefresh} schedules against. The signature is
 * deliberately **not** verified: the client has no signing key and does not
 * need one, since it reads `exp` only to decide when to refresh; the server
 * still verifies every token it is handed. `exp` is seconds since the epoch
 * (RFC 7519), converted to milliseconds to match the rest of the client.
 *
 * Throws with a specific message when the string is not a well-formed JWT, the
 * payload is not valid base64url JSON, or `exp` is missing or non-numeric — so
 * a misconfigured token surfaces loudly at refresh time instead of silently
 * appearing to never expire. Pass a custom `expiry` to `createTokenRefresh`
 * for opaque (non-JWT) tokens.
 */
export const decodeJwtExpiry = (token: string): number => {
  const parts = token.split('.')
  const payloadSegment = parts[1]
  if (parts.length !== 3 || payloadSegment === undefined) {
    throw new Error('decodeJwtExpiry: not a JWT (expected three dot-separated segments)')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(base64UrlDecode(payloadSegment))
  } catch (cause) {
    throw new Error('decodeJwtExpiry: JWT payload is not valid base64url JSON', { cause })
  }
  if (typeof parsed !== 'object' || parsed === null || !('exp' in parsed)) {
    throw new Error('decodeJwtExpiry: JWT payload has no `exp` claim')
  }
  const exp = parsed.exp
  if (typeof exp !== 'number' || !Number.isFinite(exp)) {
    throw new Error('decodeJwtExpiry: JWT `exp` claim is not a finite number')
  }
  return exp * 1000
}
