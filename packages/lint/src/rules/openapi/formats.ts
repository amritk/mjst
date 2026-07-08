import type { Format } from '../../core'

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const openapiVersion = (document: unknown): string | undefined =>
  isObject(document) && typeof document['openapi'] === 'string' ? document['openapi'] : undefined

/** Matches OpenAPI/Swagger 2.0 (`swagger: "2.0"`). */
export const oas2: Format = (document) => isObject(document) && document['swagger'] === '2.0'
/** Matches any OpenAPI 3.x (`openapi: 3.*`). */
export const oas3: Format = (document) => openapiVersion(document)?.startsWith('3.') ?? false
/** Matches OpenAPI 3.0.x specifically. */
export const oas3_0: Format = (document) => openapiVersion(document)?.startsWith('3.0') ?? false
/** Matches OpenAPI 3.1.x specifically. */
export const oas3_1: Format = (document) => openapiVersion(document)?.startsWith('3.1') ?? false
/** Matches OpenAPI 3.2.x specifically. */
export const oas3_2: Format = (document) => openapiVersion(document)?.startsWith('3.2') ?? false

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
