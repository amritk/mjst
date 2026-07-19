/**
 * Serializes an object the way the server parses it: repeats for arrays,
 * `String` for scalars, skips `undefined`. Shared by the client's query
 * serialization and the opt-in form body serializer so both sides of the
 * urlencoded wire format stay one implementation.
 */
export const toSearchParams = (values: Readonly<Record<string, unknown>>): URLSearchParams => {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, String(item))
    } else {
      search.append(key, String(value))
    }
  }
  return search
}
