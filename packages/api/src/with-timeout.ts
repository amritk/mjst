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
 * actually stops.
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
    const deadline = new Promise<Reply>((resolve) => {
      timer = setTimeout(() => resolve(onTimeout(context)), ms)
    })
    // The async wrapper turns a synchronous handler throw into a rejection so
    // the caller always gets a promise, never a thrown call.
    const run = (async () => handler(context))()
    return Promise.race([run, deadline]).finally(() => {
      if (timer !== undefined) clearTimeout(timer)
    })
  }
}
