import type { BodySerializer } from './create-client'

/** Builds the FormData the way the server's multipart parser expects it. */
const toFormData = (values: Readonly<Record<string, unknown>>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue
    if (value instanceof Blob) {
      data.append(key, value)
    } else if (Array.isArray(value)) {
      // A repeated field can carry files too (multi-file upload), so keep Blob
      // items intact rather than String-coercing them to "[object File]".
      for (const item of value) data.append(key, item instanceof Blob ? item : String(item))
    } else {
      data.append(key, String(value))
    }
  }
  return data
}

/**
 * Opt-in serializer for `bodyType: 'multipart'` contracts — `FormData` with
 * `File`/`Blob` parts intact and `String` coercion for scalar fields.
 * Register it via `createClient(contracts, url, { serializers:
 * [multipartBodySerializer] })`; apps that never import it never bundle the
 * FormData path.
 *
 * No `contentType` here: fetch stamps the multipart header itself because it
 * must include the boundary.
 */
export const multipartBodySerializer: BodySerializer = {
  bodyType: 'multipart',
  serialize: (body) => toFormData(body as Readonly<Record<string, unknown>>),
}
