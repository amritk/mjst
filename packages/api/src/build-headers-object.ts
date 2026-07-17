import { coercePrimitive } from './coerce-primitive'
import type { CompiledHeaders } from './types'

/**
 * Builds the object a route's headers schema validates. Headers differ from
 * params and query in two ways: the transport only offers lookup (no
 * enumeration), so only the schema's declared names — captured at startup —
 * are read; and a header carries one value, so array coercions do not apply.
 * Absent headers are simply omitted, which lets `required` distinguish a
 * missing header from an empty one.
 */
export const buildHeadersObject = (
  header: (name: string) => string | undefined,
  compiled: CompiledHeaders,
): Record<string, unknown> => {
  const headers: Record<string, unknown> = {}
  for (const [property, lookup] of compiled.names) {
    const raw = header(lookup)
    if (raw === undefined) continue
    const coercion = compiled.coercions.get(property)
    headers[property] = coercion === 'number' || coercion === 'boolean' ? coercePrimitive(raw, coercion) : raw
  }
  return headers
}
