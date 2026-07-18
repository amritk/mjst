/**
 * Marks errors thrown by `createClient` when a server reply carries a status
 * the contract never declared. A marker property (rather than an error
 * subclass) survives bundling, realm boundaries, and duplicate copies of this
 * package in one dependency tree — `instanceof` checks do not.
 */
const MARKER = 'amritk.api.unexpectedStatus'

/**
 * Creates the error a client call throws for an undeclared status. Throwing —
 * rather than widening every reply union with a `{ status: number }` variant —
 * keeps `status === 200` narrowing exact; a client that wants to handle a
 * status (the pipeline's own 400, say) declares it in the contract. The
 * response is attached with its body unread, so a catch can still inspect it.
 */
export const unexpectedStatusError = (routeName: string, response: Response): Error => {
  const error = new Error(`Undeclared ${response.status} response for '${routeName}'`)
  error.name = 'UnexpectedStatusError'
  const marked = error as Error & Record<string, unknown>
  marked[MARKER] = true
  marked['response'] = response
  return error
}

/**
 * Whether an unknown thrown value is an undeclared-status error from
 * {@link unexpectedStatusError}. Narrows to the shape carrying the unread
 * `response`, so error handling can read the status and body.
 */
export const isUnexpectedStatusError = (error: unknown): error is Error & { readonly response: Response } =>
  typeof error === 'object' && error !== null && (error as Record<string, unknown>)[MARKER] === true
