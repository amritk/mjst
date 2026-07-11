/** True for a non-null, non-array object (an OpenAPI "object" value). */
export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// The eight standard HTTP methods that have a dedicated fixed field on the Path
// Item Object. Shared by the rules that iterate a path item's operations.
export const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'])

// OpenAPI 3.2 promoted `query` to a fixed Path Item Object operation field, so the
// rules that walk a path item's operations must consider it too. Including it is
// harmless on older versions, which never carry a `query` operation, so the same
// set works across every OpenAPI version.
export const OPERATION_METHODS = new Set([...HTTP_METHODS, 'query'])
