/**
 * Marks errors thrown by body readers when a request exceeds the adapter's
 * `maxBodyBytes`. A marker property (rather than an error subclass) survives
 * bundling, realm boundaries, and duplicate copies of this package in one
 * dependency tree — `instanceof` checks do not.
 */
const MARKER = 'amritk.api.payloadTooLarge'

/**
 * Creates the error a body reader throws when the payload exceeds the
 * configured limit. The pipeline recognizes it (via
 * {@link isPayloadTooLargeError}) and answers 413 instead of treating it as a
 * handler crash — including when a handler triggered the read itself through
 * `readText`/`readBytes`.
 */
export const payloadTooLargeError = (limit: number): Error => {
  const error = new Error(`Request body exceeds the ${limit}-byte limit`)
  error.name = 'PayloadTooLargeError'
  ;(error as Error & Record<string, unknown>)[MARKER] = true
  return error
}

/**
 * Whether an unknown thrown value is a body-size-limit error from
 * {@link payloadTooLargeError}.
 */
export const isPayloadTooLargeError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as Record<string, unknown>)[MARKER] === true
