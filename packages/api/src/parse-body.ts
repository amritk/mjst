import { assignQueryPair } from './build-query-object'
import { buildQueryObjectFromString } from './build-query-object-from-string'
import type { BodyType, Coercion } from './types'

/**
 * Media-type acceptance per declared body type. Only consulted when the
 * request actually carries a `content-type` header — a client that sends none
 * gets the benefit of the doubt (the parse itself will reject garbage), which
 * keeps bare `curl --data-binary` and hand-rolled test clients working.
 *
 * Exported so `compileToModule` output can import it: both engines must draw
 * the 415 line in exactly the same place.
 */
export const matchesBodyType = (contentType: string, bodyType: BodyType): boolean => {
  // Parameters (`; charset=utf-8`) never participate in the decision.
  const mediaType = (contentType.split(';')[0] ?? contentType).trim().toLowerCase()
  switch (bodyType) {
    case 'json':
      // Structured syntax suffixes (application/problem+json, …) are JSON.
      return mediaType === 'application/json' || mediaType.endsWith('+json')
    case 'form':
      return mediaType === 'application/x-www-form-urlencoded'
    case 'multipart':
      return mediaType === 'multipart/form-data'
  }
}

/**
 * Parses an `application/x-www-form-urlencoded` body into the object the
 * route's body schema validates. Form bodies are the query string's wire
 * format, so this reuses the query machinery outright — the same coercion
 * plan semantics (typed keys coerce, array keys accumulate, undeclared keys
 * pass through as strings) and the same null-prototype hardening.
 */
export const parseFormBody = (text: string, coercions: ReadonlyMap<string, Coercion>): Record<string, unknown> =>
  buildQueryObjectFromString(text, coercions)

/**
 * Parses a `multipart/form-data` body into the object the route's body schema
 * validates. Parsing itself is delegated to the platform's `Response#formData`
 * (undici on Node, workerd/Bun natively) rather than a hand-rolled boundary
 * scanner — every runtime this package supports ships a battle-tested one.
 *
 * String parts coerce per the plan, exactly like form fields; file parts stay
 * `File` objects (name, type, `arrayBuffer()`), so declare them in the schema
 * without a `type` keyword (`{}` or `{ contentMediaType: 'image/png' }`) —
 * a `type: 'string'` constraint would reject the File value. Repeated string
 * keys accumulate when the schema declares an array; repeated file keys keep
 * the last file.
 */
export const parseMultipartBody = async (
  bytes: Uint8Array,
  contentType: string | undefined,
  coercions: ReadonlyMap<string, Coercion>,
): Promise<Record<string, unknown>> => {
  // The boundary lives in the content-type header, so parsing cannot proceed
  // without one — this throws and the pipeline answers the invalid-body 400.
  if (contentType === undefined) throw new Error('multipart body without a content-type boundary')
  const form = await new Response(bytes, { headers: { 'content-type': contentType } }).formData()
  const body: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  for (const [key, value] of form) {
    if (typeof value === 'string') {
      assignQueryPair(body, key, value, coercions)
    } else {
      body[key] = value
    }
  }
  return body
}
