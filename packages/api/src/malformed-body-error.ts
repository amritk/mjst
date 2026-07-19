/**
 * Marks errors thrown by `createClient` when a declared JSON status arrives
 * with a body that does not parse. A marker property (rather than an error
 * subclass) survives bundling, realm boundaries, and duplicate copies of this
 * package in one dependency tree — `instanceof` checks do not.
 */
const MARKER = 'amritk.api.malformedBody'

/**
 * Creates the error a client call throws when a declared JSON status carries
 * an unparsable body. Without this wrapper the bare `SyntaxError` from
 * `response.json()` would surface with no route name, no status, and no way
 * to reach the response — so the `Response` rides along (its body already
 * consumed by the failed parse) and the original parse error is kept as
 * `cause` for logging.
 */
export const malformedBodyError = (routeName: string, response: Response, cause: unknown): Error => {
  const error = new Error(`Malformed body for ${response.status} response of '${routeName}'`, { cause })
  error.name = 'MalformedBodyError'
  const marked = error as Error & Record<string, unknown>
  marked[MARKER] = true
  marked['response'] = response
  return error
}

/**
 * Whether an unknown thrown value is a malformed-body error from
 * {@link malformedBodyError}. Narrows to the shape carrying the `response`,
 * so error handling can read the status and headers of the reply that failed
 * to parse.
 */
export const isMalformedBodyError = (error: unknown): error is Error & { readonly response: Response } =>
  typeof error === 'object' && error !== null && (error as Record<string, unknown>)[MARKER] === true
