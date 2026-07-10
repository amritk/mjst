/** True for a non-null, non-array object (an OpenAPI "object" value). */
export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// The eight standard HTTP methods that have a dedicated fixed field on the Path
// Item Object. Shared by the rules that iterate a path item's operations.
export const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'])
