/**
 * Marks errors thrown by body readers when a request exceeds the adapter's
 * `maxBodyBytes`. A marker property (rather than an error subclass) survives
 * bundling, realm boundaries, and duplicate copies of this package in one
 * dependency tree — `instanceof` checks do not.
 */
const MARKER = 'amritk.api.payloadTooLarge'

/**
 * The body-size limit (1 MiB) applied when `maxBodyBytes` is not set on an
 * adapter or on `compileToModule`. Unbounded body reads are a memory-DoS
 * waiting to happen, so the cap is opt-out (`maxBodyBytes: Infinity`) rather
 * than opt-in. Shared here so the fetch adapter, the Node adapter, and the
 * compiled engine all agree on the exact byte.
 */
export const DEFAULT_MAX_BODY_BYTES = 1_048_576

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
 * Whether an unknown thrown value is a body-size-limit error — either our own
 * (from {@link payloadTooLargeError}) or the equivalent raised by the server
 * this API is mounted on.
 *
 * When the adapter runs inside another framework, that framework's own body
 * reader may reject an oversized payload before the pipeline's cap is reached.
 * Fastify's content-type parser throws `FST_ERR_CTP_BODY_TOO_LARGE` at its
 * `bodyLimit` (default ~1 MiB, often raised to e.g. 20 MiB); Express's
 * `body-parser`/`raw-body` throws an `entity.too.large` error. Both surface to
 * the handler as thrown errors that carry a 413 status, and without
 * recognizing them here they would take the generic `onError`/500 path — the
 * exact symptom of a 20 MiB body returning `500 {code:'unknown'}` instead of a
 * 413. We match on the framework-agnostic signals (Fastify's `code`,
 * raw-body's `type`, and a `statusCode`/`status` of 413) rather than
 * `instanceof`, so the check survives bundling and duplicate copies of those
 * packages just like our own marker does.
 */
export const isPayloadTooLargeError = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false
  const record = error as Record<string, unknown>
  return (
    record[MARKER] === true ||
    // Fastify content-type parser at its `bodyLimit`.
    record['code'] === 'FST_ERR_CTP_BODY_TOO_LARGE' ||
    // Express body-parser / raw-body.
    record['type'] === 'entity.too.large' ||
    // Any HTTP error object that already declares a 413 (http-errors, Koa,
    // hand-rolled). Only 413 is body-size — no other status is remapped.
    record['statusCode'] === 413 ||
    record['status'] === 413
  )
}
