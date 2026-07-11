import type { Format } from '../../core'

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const openapiVersion = (document: unknown): string | undefined =>
  isObject(document) && typeof document['openapi'] === 'string' ? document['openapi'] : undefined

// Minor versions are matched with an anchored `3.N` followed by a `.` or the
// end of string, so a future `3.10.x` is not mistaken for `3.1.x` — a plain
// `startsWith('3.1')` prefix check would misclassify `3.10.0` as OpenAPI 3.1.
const matchesMinor = (document: unknown, minor: 0 | 1 | 2): boolean => {
  const version = openapiVersion(document)
  return version !== undefined && new RegExp(`^3\\.${minor}(\\.|$)`).test(version)
}

/** Matches OpenAPI/Swagger 2.0 (`swagger: "2.0"`). */
export const oas2: Format = (document) => isObject(document) && document['swagger'] === '2.0'
/** Matches any OpenAPI 3.x (`openapi: 3.*`). */
export const oas3: Format = (document) => /^3\.\d/.test(openapiVersion(document) ?? '')
/** Matches OpenAPI 3.0.x specifically. */
export const oas3_0: Format = (document) => matchesMinor(document, 0)
/** Matches OpenAPI 3.1.x specifically. */
export const oas3_1: Format = (document) => matchesMinor(document, 1)
/** Matches OpenAPI 3.2.x specifically. */
export const oas3_2: Format = (document) => matchesMinor(document, 2)

/** OpenAPI format detectors keyed by Loupe-compatible names. */
export const oasFormats: Record<string, Format> = {
  oas2,
  oas3,
  'oas3.0': oas3_0,
  oas3_0,
  'oas3.1': oas3_1,
  oas3_1,
  'oas3.2': oas3_2,
  oas3_2,
}
