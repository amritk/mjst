/**
 * The slice of a platform execution context that can keep work alive past the
 * response — Cloudflare Workers' `ctx.waitUntil`, Deno Deploy's equivalent.
 * `createApi({ context })` receives this as `executionContext`.
 */
export type WaitUntilContext = {
  readonly waitUntil: (promise: Promise<unknown>) => void
}

const hasWaitUntil = (context: unknown): context is WaitUntilContext =>
  typeof context === 'object' &&
  context !== null &&
  typeof (context as Record<string, unknown>)['waitUntil'] === 'function'

/**
 * Runs work *after* the response is sent, without blocking it — FastAPI's
 * `BackgroundTasks`, Rails' `ActiveJob.perform_later`, Laravel's `dispatch`.
 * On a platform with `waitUntil` (Workers), the task is registered so the
 * runtime keeps the invocation alive until it settles; elsewhere it runs
 * detached. A rejected task never becomes an unhandled rejection — it goes to
 * `onError` (default: swallowed), because after-response work must not crash
 * the process that already replied.
 *
 * Reach it from a handler by threading `executionContext` through the context
 * factory (see the example); the raw platform value is not on `ApiRequest` by
 * design.
 *
 * @example
 * ```typescript
 * const api = createApi({
 *   routes,
 *   context: ({ executionContext }) => ({
 *     background: (task: () => Promise<unknown>) => runAfterResponse(executionContext, task),
 *   }),
 * })
 * // in a handler:
 * ctx.context.background(() => sendWelcomeEmail(user))
 * return { status: 201, body: user }
 * ```
 */
export const runAfterResponse = (
  executionContext: unknown,
  task: () => Promise<unknown> | unknown,
  onError?: (error: unknown) => void,
): void => {
  const promise = (async () => {
    try {
      await task()
    } catch (error) {
      if (onError !== undefined) onError(error)
    }
  })()
  if (hasWaitUntil(executionContext)) executionContext.waitUntil(promise)
  // Otherwise the promise runs detached; its errors are already handled above.
}

/**
 * Binds {@link runAfterResponse} to one execution context — the ergonomic form
 * for a context factory, which then hands `background` to every handler.
 *
 * @example
 * ```typescript
 * context: ({ executionContext }) => ({ ...createBackground(executionContext) })
 * // handler: ctx.context.background(() => auditLog.write(entry))
 * ```
 */
export const createBackground = (
  executionContext: unknown,
  onError?: (error: unknown) => void,
): { readonly background: (task: () => Promise<unknown> | unknown) => void } => ({
  background: (task) => runAfterResponse(executionContext, task, onError),
})
