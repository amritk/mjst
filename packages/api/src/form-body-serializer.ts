import type { BodySerializer } from './create-client'
import { toSearchParams } from './to-search-params'

/**
 * Opt-in serializer for `bodyType: 'form'` contracts — urlencoded pairs with
 * array repeats, matching how the server parses them back. Register it via
 * `createClient(contracts, url, { serializers: [formBodySerializer] })`;
 * JSON-only apps that never import it never bundle it.
 *
 * No `contentType` here: `URLSearchParams` bodies carry their own
 * `application/x-www-form-urlencoded` header, stamped by fetch.
 */
export const formBodySerializer: BodySerializer = {
  bodyType: 'form',
  serialize: (body) => toSearchParams(body as Readonly<Record<string, unknown>>),
}
