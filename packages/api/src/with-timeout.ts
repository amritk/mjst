/**
 * Wraps a route handler with a wall-clock deadline — the `requestTimeout` /
 * `onTimeout` control Fastify exposes, which this framework left to the app.
 * If the handler has not settled after `ms`, `onTimeout` produces the reply
 * instead (typically a `503`/`504` the route declares), and the slow handler's
 * eventual result is discarded. The timer is always cleared, so a fast handler
 * pays nothing beyond one `Promise.race`.
 *
 * This bounds the time *this* handler occupies the pipeline; it does not kill
 * work the handler already handed to the platform. For a handler that honors
 * cancellation, wire `request.signal` into its own I/O so the abandoned work
 * actually stops. An `onTimeout` that throws rejects the call, which the
 * pipeline reports through `onError` like any other handler failure.
 *
 * @example
 * ```typescript
 * const search = defineRoute({
 *   method: 'get',
 *   path: '/search',
 *   responses: { 200: { body: resultsSchema }, 504: {} },
 *   handler: withTimeout(2_000, runSearch, () => ({ status: 504 as const })),
 * })
 * ```
 */
export const withTimeout = <Context, Reply>(
  ms: number,
  handler: (context: Context) => Reply | Promise<Reply>,
  onTimeout: (context: Context) => Reply,
): ((context: Context) => Promise<Reply>) => {
  return (context) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<Reply>((resolve, reject) => {
      // `onTimeout` is app code running inside a timer callback, where a throw
      // has nowhere to go: on Node it is an uncaught exception that takes the
      // process down, and the race it was meant to settle never settles, so
      // the request hangs too. Rejecting instead routes it to the pipeline's
      // ordinary handler-error boundary and the 500 it produces.
      timer = setTimeout(() => {
        try {
          resolve(onTimeout(context))
        } catch (error) {
          reject(error as Error)
        }
      }, ms)
    })
    // The async wrapper turns a synchronous handler throw into a rejection so
    // the caller always gets a promise, never a thrown call.
    const run = (async () => handler(context))()
    return Promise.race([run, deadline]).finally(() => {
      if (timer !== undefined) clearTimeout(timer)
    })
  }
}
