import type { ResponseHeaders } from './types'

/**
 * Turns an {@link ApiResponse}'s header record into a `Headers` instance,
 * sending array values as that many separate header lines — the only correct
 * encoding for `set-cookie`, which RFC 6265 forbids folding into one
 * comma-separated value. `contentType` seeds the default `content-type`
 * first, so a handler-supplied header still wins (matching the old spread
 * semantics `{ 'content-type': ..., ...headers }`).
 *
 * Both engines share this helper (the compiled module imports it), so
 * repeated headers serialize identically everywhere. Only responses that
 * actually carry custom headers pay for the `Headers` construction — the
 * bare-reply fast paths never call this.
 */
export const buildResponseHeaders = (headers: ResponseHeaders, contentType?: string): Headers => {
  const result = new Headers()
  if (contentType !== undefined) result.set('content-type', contentType)
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      // Replace, not extend: the array is the complete set for this name.
      result.delete(name)
      for (const item of value) result.append(name, item as string)
    } else {
      result.set(name, value as string)
    }
  }
  return result
}
