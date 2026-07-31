/**
 * The two recognizable errors `createClient` throws — an undeclared status,
 * and a declared JSON status whose body does not parse. They live in one
 * module because they are the same shape built the same way: a plain `Error`
 * carrying the `Response` plus a marker property. Markers (rather than error
 * subclasses) survive bundling, realm boundaries, and duplicate copies of
 * this package in one dependency tree — `instanceof` checks do not — and the
 * shared constructor keeps the pair from shipping two copies of identical
 * scaffolding in every browser bundle.
 */
const MALFORMED_BODY = 'amritk.api.malformedBody'
const UNEXPECTED_STATUS = 'amritk.api.unexpectedStatus'

/** Builds one marked client error; the factories below pick name and message. */
const clientError = (name: string, message: string, marker: string, response: Response, cause?: unknown): Error => {
  const error = new Error(message, { cause })
  error.name = name
  const marked = error as Error & Record<string, unknown>
  marked[marker] = true
  marked['response'] = response
  return error
}

/** Whether a thrown value carries one of the markers, narrowed to the shape with the `Response`. */
const isClientError = (error: unknown, marker: string): error is Error & { readonly response: Response } =>
  typeof error === 'object' && error !== null && (error as Record<string, unknown>)[marker] === true

/**
 * Creates the error a client call throws when a declared JSON status carries
 * an unparsable body. Without this wrapper the bare `SyntaxError` from
 * `response.json()` would surface with no route name, no status, and no way
 * to reach the response — so the `Response` rides along (its body already
 * consumed by the failed parse) and the original parse error is kept as
 * `cause` for logging.
 */
export const malformedBodyError = (routeName: string, response: Response, cause: unknown): Error =>
  clientError(
    'MalformedBodyError',
    `Malformed body for ${response.status} response of '${routeName}'`,
    MALFORMED_BODY,
    response,
    cause,
  )

/**
 * Whether an unknown thrown value is a malformed-body error from
 * {@link malformedBodyError}. Narrows to the shape carrying the `response`,
 * so error handling can read the status and headers of the reply that failed
 * to parse.
 */
export const isMalformedBodyError = (error: unknown): error is Error & { readonly response: Response } =>
  isClientError(error, MALFORMED_BODY)

/**
 * Creates the error a client call throws for an undeclared status. Throwing —
 * rather than widening every reply union with a `{ status: number }` variant —
 * keeps `status === 200` narrowing exact; a client that wants to handle a
 * status (the pipeline's own 400, say) declares it in the contract. The
 * response is attached with its body unread, so a catch can still inspect it.
 */
export const unexpectedStatusError = (routeName: string, response: Response): Error =>
  clientError(
    'UnexpectedStatusError',
    `Undeclared ${response.status} response for '${routeName}'`,
    UNEXPECTED_STATUS,
    response,
  )

/**
 * Whether an unknown thrown value is an undeclared-status error from
 * {@link unexpectedStatusError}. Narrows to the shape carrying the unread
 * `response`, so error handling can read the status and body.
 */
export const isUnexpectedStatusError = (error: unknown): error is Error & { readonly response: Response } =>
  isClientError(error, UNEXPECTED_STATUS)
