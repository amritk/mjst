import type { ApiRequest, ApiResponse, OnErrorDetails } from './types'

/**
 * What {@link createSentry} hands the capture function for every thrown
 * handler (or context factory) error. Shaped so mapping onto a Sentry-style
 * client is one call: the route pattern is the grouping key (raw URLs with
 * IDs in them group terribly), and `env`/`executionContext` are what
 * Workers-side clients (Toucan, @sentry/cloudflare) need to read their DSN
 * and flush via `waitUntil`.
 */
export type ErrorCaptureInfo = {
  readonly request: ApiRequest
  /** The matched route pattern, e.g. `'/users/{id}'`. */
  readonly route: string
  /** Uppercase HTTP method of the failing request. */
  readonly method: string
  readonly env: unknown
  readonly executionContext: unknown
}

/**
 * Options for {@link createSentry}.
 */
export type SentryOptions = {
  /**
   * Reports one error. Wire it to whatever client the platform uses —
   * `Sentry.captureException` on Node, a per-request Toucan instance on
   * Workers. A throwing capture is swallowed: error reporting must never
   * turn a 500 into a crash.
   */
  readonly capture: (error: unknown, info: ErrorCaptureInfo) => void
  /**
   * Shapes the client-facing response after capture. Defaults to the bare
   * `500 {error:'internal_error'}` the pipeline would send anyway — capture
   * is observation, not response policy.
   */
  readonly respond?: (error: unknown, request: ApiRequest) => ApiResponse
}

/**
 * The deliberately tiny Sentry integration: an `onError` implementation that
 * reports and then responds. It takes a capture *function* rather than a
 * Sentry client so this package depends on nothing — any SDK (or none, in
 * tests) fits behind it.
 *
 * @example
 * ```typescript
 * // Cloudflare Workers with Toucan — a fresh client per request, flushed
 * // past the response via waitUntil.
 * const sentry = createSentry({
 *   capture: (error, { route, method, env, executionContext }) => {
 *     const client = new Toucan({
 *       dsn: (env as Env).SENTRY_DSN,
 *       context: executionContext as ExecutionContext,
 *     })
 *     client.setTag('route', `${method} ${route}`)
 *     client.captureException(error)
 *   },
 * })
 * const api = createApi({ routes, onError: sentry.onError })
 * ```
 */
export const createSentry = (
  options: SentryOptions,
): { readonly onError: (error: unknown, request: ApiRequest, details: OnErrorDetails) => ApiResponse } => {
  const respond = options.respond ?? (() => INTERNAL_ERROR)
  return {
    onError: (error, request, details) => {
      try {
        options.capture(error, {
          request,
          route: details.route.path,
          method: details.route.method.toUpperCase(),
          env: details.env,
          executionContext: details.executionContext,
        })
      } catch {
        // Reporting failed; the client still deserves its 500.
      }
      return respond(error, request)
    },
  }
}

/** Mirrors the pipeline's own default so opting into capture changes nothing on the wire. */
const INTERNAL_ERROR: ApiResponse = Object.freeze({ status: 500, body: Object.freeze({ error: 'internal_error' }) })
